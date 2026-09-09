# setup-azure-workbook.ps1 -- Deploy the RAG Agent observability workbook and
# drift-detection alert rules to Azure Monitor.
#
# Usage:
#   .\scripts\setup-azure-workbook.ps1
#   .\scripts\setup-azure-workbook.ps1 -NoAlerts   # workbook only
#
# Prerequisites:
#   - Azure CLI installed and authenticated (run: az login)
#   - .\scripts\setup-azure-monitor.ps1 already run, so the resource
#     group and Application Insights resource exist
#   - PowerShell 5.1+ (Windows) or PowerShell 7+ (cross-platform)
#
# The script is idempotent. The workbook resource name is derived
# deterministically from the resource group id, so re-running UPDATES
# the existing workbook rather than creating a duplicate.
#
# Deploys:
#   azure\workbook.bicep  -> one workbook, five tabs, 29 parity items
#                            plus 3 log items
#   azure\alerts.bicep    -> three scheduled query rules (drift detection)

[CmdletBinding()]
param(
    [switch]$NoAlerts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$AzureDir = Join-Path $ProjectRoot 'azure'

# ---------------------------------------------------------------------------
# Load .env without clobbering anything already set in this session.
# ---------------------------------------------------------------------------
$EnvFile = Join-Path $ProjectRoot '.env'
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $parts = $line -split '=', 2
            if ($parts.Length -eq 2) {
                $key = $parts[0].Trim()
                $val = $parts[1].Trim()
                if ($val -match '\s+#') {
                    $val = ($val -split '\s+#', 2)[0].Trim()
                }
                if ($val.Length -ge 2 -and
                    (($val.StartsWith('"') -and $val.EndsWith('"')) -or
                     ($val.StartsWith("'") -and $val.EndsWith("'")))) {
                    $val = $val.Substring(1, $val.Length - 2)
                }
                $existing = [Environment]::GetEnvironmentVariable($key, 'Process')
                if ([string]::IsNullOrEmpty($existing)) {
                    Set-Item -Path "Env:$key" -Value $val
                }
            }
        }
    }
}

function Get-EnvOrDefault([string]$Name, [string]$Default) {
    $v = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrEmpty($v)) { return $Default }
    return $v
}

# See the long comment in setup-azure-monitor.ps1. Windows PowerShell 5.1
# wraps a native command's stderr in an ErrorRecord, which under
# $ErrorActionPreference = 'Stop' makes any az command that writes to
# stderr a TERMINATING error -- so an existence probe aborts the script
# instead of returning false. All az calls go through these helpers.
function Invoke-Az {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & az @Arguments 2>&1
        $stdout = @($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
        $stderr = @($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] })
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output   = ($stdout -join "`n").Trim()
            Errors   = ($stderr -join "`n").Trim()
        }
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-AzOrFail {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )
    $r = Invoke-Az -Arguments $Arguments
    if ($r.ExitCode -ne 0) {
        Write-Host ""
        Write-Host "ERROR: $FailureMessage" -ForegroundColor Red
        if ($r.Errors) { Write-Host $r.Errors }
        if ($r.Output) { Write-Host $r.Output }
        exit 1
    }
    return $r.Output
}

$ResourceGroup   = Get-EnvOrDefault 'AZURE_RESOURCE_GROUP'    'rg-observability-test'
$AppInsightsName = Get-EnvOrDefault 'AZURE_APP_INSIGHTS_NAME' 'appi-rag-agent'
$SubscriptionId  = Get-EnvOrDefault 'AZURE_SUBSCRIPTION_ID'   ''

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
$azCmd = Get-Command az -ErrorAction SilentlyContinue
if ($null -eq $azCmd) {
    Write-Error "The Azure CLI (az) is required but was not found. Install it: https://learn.microsoft.com/cli/azure/install-azure-cli"
}

$account = Invoke-Az -Arguments @('account', 'show', '-o', 'none')
if ($account.ExitCode -ne 0) {
    Write-Host ""
    Write-Host "ERROR: not logged in to Azure." -ForegroundColor Red
    Write-Host "Run: az login"
    exit 1
}

if (-not [string]::IsNullOrEmpty($SubscriptionId)) {
    Invoke-AzOrFail -Arguments @('account', 'set', '--subscription', $SubscriptionId) `
        -FailureMessage "Failed to set subscription $SubscriptionId" | Out-Null
}

foreach ($f in @('workbook.bicep', 'workbook.json')) {
    $p = Join-Path $AzureDir $f
    if (-not (Test-Path $p)) { Write-Error "Required file not found: $p" }
}

# `az group exists` returns true/false on stdout with exit code 0, so it
# never writes to stderr. See the Invoke-Az comment above for why that
# matters in Windows PowerShell.
if ((Invoke-Az -Arguments @('group', 'exists', '--name', $ResourceGroup)).Output -ne 'true') {
    Write-Host ""
    Write-Host "ERROR: resource group '$ResourceGroup' does not exist." -ForegroundColor Red
    Write-Host "Run .\scripts\setup-azure-monitor.ps1 first."
    exit 1
}

# List-and-count rather than `show`, which errors when absent.
$appiCount = (Invoke-Az -Arguments @(
    'resource', 'list',
    '--resource-group', $ResourceGroup,
    '--resource-type', 'microsoft.insights/components',
    '--query', "[?name=='$AppInsightsName'] | length(@)", '-o', 'tsv'
)).Output

if ($appiCount -ne '1') {
    Write-Host ""
    Write-Host "ERROR: Application Insights resource '$AppInsightsName' not found in resource group '$ResourceGroup'." -ForegroundColor Red
    Write-Host "Run .\scripts\setup-azure-monitor.ps1 first."
    exit 1
}

Write-Host "Resource group : $ResourceGroup"
Write-Host "App Insights   : $AppInsightsName"
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Workbook
# ---------------------------------------------------------------------------
Write-Host "[1/2] Deploying workbook..."
$WorkbookId = Invoke-AzOrFail -Arguments @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroup,
    '--name', 'rag-agent-workbook',
    '--template-file', (Join-Path $AzureDir 'workbook.bicep'),
    '--parameters', "appInsightsName=$AppInsightsName",
    '--query', 'properties.outputs.workbookResourceId.value', '-o', 'tsv'
) -FailureMessage "Workbook deployment failed."
Write-Host "      Workbook deployed."

# ---------------------------------------------------------------------------
# 2. Alert rules
# ---------------------------------------------------------------------------
if (-not $NoAlerts) {
    Write-Host "[2/2] Deploying drift-detection alert rules..."
    Invoke-AzOrFail -Arguments @(
        'deployment', 'group', 'create',
        '--resource-group', $ResourceGroup,
        '--name', 'rag-agent-alerts',
        '--template-file', (Join-Path $AzureDir 'alerts.bicep'),
        '--parameters', "appInsightsName=$AppInsightsName",
        '--output', 'none'
    ) -FailureMessage "Alert rule deployment failed." | Out-Null
    Write-Host "      Three rules deployed (severity 2, no action groups)."
} else {
    Write-Host "[2/2] Skipped alert rules (-NoAlerts)."
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "Open the workbook:"
Write-Host "  https://portal.azure.com/#@/resource$WorkbookId"
Write-Host ""
Write-Host "Before trusting any panel, generate traffic and confirm each signal"
Write-Host "actually arrived:"
Write-Host ""
Write-Host "  .\scripts\simulate-demo-traffic.ps1 -DurationMinutes 10"
Write-Host ""
Write-Host "Then run these in the App Insights Logs blade -- all five must"
Write-Host "return rows:"
Write-Host "  requests      | summarize count() by cloud_RoleName"
Write-Host "  dependencies  | summarize count() by name"
Write-Host "  customMetrics | summarize count() by name"
Write-Host "  traces        | summarize count() by severityLevel"
Write-Host "  exceptions    | summarize count()"
Write-Host ""
Write-Host "An empty panel is the failure mode that matters here. The drift"
Write-Host "rules need roughly an hour of traffic before their baselines mean"
Write-Host "anything."
