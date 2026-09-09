# setup-azure-monitor.ps1 -- Stand up the Azure Monitor resources this stack
# needs, then print the connection string to paste into .env.
#
# Usage:
#   .\scripts\setup-azure-monitor.ps1
#
# Prerequisites:
#   - Azure CLI installed and authenticated (run: az login)
#   - Permission to create resource groups in the target subscription
#   - PowerShell 5.1+ (Windows) or PowerShell 7+ (cross-platform)
#
# What this script creates (all idempotent -- safe to re-run):
#   1. Resource group, tagged with Purpose and "Responsible Owner"
#   2. Log Analytics workspace  (Application Insights is workspace-based
#      now, so this is a hard requirement, not an option)
#   3. Application Insights resource, linked to that workspace
#
# It does NOT deploy the workbook or alert rules -- that is
# scripts\setup-azure-workbook.ps1, run after this one.
#
# Nothing needs creating by hand in the portal. The only manual step is
# copying the printed connection string into .env.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# ---------------------------------------------------------------------------
# Load .env without clobbering anything already set in this session. An
# existing value wins, so you can override a single setting for one run
# without editing the file.
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

# Every az call goes through this helper, and it is not optional plumbing.
#
# Windows PowerShell 5.1 wraps a native command's stderr output in an
# ErrorRecord (NativeCommandError). With $ErrorActionPreference = 'Stop'
# that turns ANY az command which writes to stderr into a TERMINATING
# error -- so an innocent "does this resource exist yet?" probe aborts the
# whole script instead of returning false, which is precisely the state a
# first run is in.
#
# This helper neutralises that for the duration of the call and hands back
# the exit code plus stdout, so existence checks can be plain booleans.
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

# ---------------------------------------------------------------------------
# Defaults. Override any of these in .env.
# ---------------------------------------------------------------------------
$ResourceGroup     = Get-EnvOrDefault 'AZURE_RESOURCE_GROUP'    'rg-observability-test'
$Location          = Get-EnvOrDefault 'AZURE_LOCATION'          'uksouth'
$AppInsightsName   = Get-EnvOrDefault 'AZURE_APP_INSIGHTS_NAME' 'appi-rag-agent'
$LogAnalyticsName  = Get-EnvOrDefault 'AZURE_LOG_ANALYTICS_NAME' 'law-rag-agent'
$TagPurpose        = Get-EnvOrDefault 'AZURE_TAG_PURPOSE'        ''
$TagOwner          = Get-EnvOrDefault 'AZURE_TAG_RESPONSIBLE_OWNER' ''
$SubscriptionId    = Get-EnvOrDefault 'AZURE_SUBSCRIPTION_ID'    ''

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
    Write-Host "Setting subscription to $SubscriptionId"
    Invoke-AzOrFail -Arguments @('account', 'set', '--subscription', $SubscriptionId) `
        -FailureMessage "Failed to set subscription $SubscriptionId" | Out-Null
}

$SubscriptionName = Invoke-AzOrFail -Arguments @('account', 'show', '--query', 'name', '-o', 'tsv') `
    -FailureMessage "Could not read the current subscription name."
$SubscriptionIdResolved = Invoke-AzOrFail -Arguments @('account', 'show', '--query', 'id', '-o', 'tsv') `
    -FailureMessage "Could not read the current subscription id."

# Both tags are required by policy. Fail early and loudly rather than
# creating an untagged resource group that then has to be fixed by hand.
$missing = @()
if ([string]::IsNullOrEmpty($TagPurpose)) { $missing += 'AZURE_TAG_PURPOSE' }
if ([string]::IsNullOrEmpty($TagOwner))   { $missing += 'AZURE_TAG_RESPONSIBLE_OWNER' }
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "ERROR: required resource group tag value(s) not set: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "Add them to .env, for example:"
    Write-Host "  AZURE_TAG_PURPOSE=Observability backend comparison spike"
    Write-Host "  AZURE_TAG_RESPONSIBLE_OWNER=tom.coppock@tungstenautomation.com"
    exit 1
}

# The application-insights commands live in an extension. Query the list
# rather than probing with `extension show`, which errors when absent --
# and "absent" is the normal case on a first run.
$extCount = Invoke-Az -Arguments @('extension', 'list',
    '--query', "[?name=='application-insights'] | length(@)", '-o', 'tsv')
if ($extCount.ExitCode -ne 0 -or $extCount.Output -ne '1') {
    Write-Host "Installing the application-insights CLI extension..."
    Invoke-AzOrFail -Arguments @('extension', 'add', '--name', 'application-insights') `
        -FailureMessage "Could not install the application-insights CLI extension." | Out-Null
}

Write-Host "Subscription : $SubscriptionName ($SubscriptionIdResolved)"
Write-Host "Location     : $Location"
Write-Host "Resource grp : $ResourceGroup"
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Resource group
# ---------------------------------------------------------------------------
# `az group create` is a PUT: it creates the group when absent and updates
# its tags when present. So there is no branch, and no need for
# `az group update --set tags."Responsible Owner"=...`, whose quoting of a
# tag key containing a space is fragile across shells.
#
# `az group exists` is used only to report which happened. Unlike
# `az group show` it returns true/false on stdout with exit code 0, so it
# never writes to stderr and never trips the PowerShell 5.1 behaviour
# described above Invoke-Az.
$rgExists = (Invoke-Az -Arguments @('group', 'exists', '--name', $ResourceGroup)).Output

if ($rgExists -eq 'true') {
    Write-Host "[1/3] Resource group $ResourceGroup exists -- applying tags"
} else {
    Write-Host "[1/3] Creating resource group $ResourceGroup"
}

# "Responsible Owner" contains a space, so the whole key=value pair is
# passed as a single argument.
Invoke-AzOrFail -Arguments @(
    'group', 'create',
    '--name', $ResourceGroup,
    '--location', $Location,
    '--tags', "Purpose=$TagPurpose", "Responsible Owner=$TagOwner",
    '--output', 'none'
) -FailureMessage "Could not create or update resource group '$ResourceGroup'. Check you have permission to create resource groups in this subscription, and that '$Location' is a valid region." | Out-Null

# ---------------------------------------------------------------------------
# 2. Log Analytics workspace
# ---------------------------------------------------------------------------
# Existence is tested with a list-and-count query rather than `show`,
# because `show` errors when the resource is absent.
$lawCount = (Invoke-Az -Arguments @(
    'monitor', 'log-analytics', 'workspace', 'list',
    '--resource-group', $ResourceGroup,
    '--query', "[?name=='$LogAnalyticsName'] | length(@)", '-o', 'tsv'
)).Output

if ($lawCount -eq '1') {
    Write-Host "[2/3] Log Analytics workspace $LogAnalyticsName exists"
} else {
    Write-Host "[2/3] Creating Log Analytics workspace $LogAnalyticsName"
    Invoke-AzOrFail -Arguments @(
        'monitor', 'log-analytics', 'workspace', 'create',
        '--resource-group', $ResourceGroup,
        '--workspace-name', $LogAnalyticsName,
        '--location', $Location,
        '--output', 'none'
    ) -FailureMessage "Log Analytics workspace creation failed." | Out-Null
}

$WorkspaceId = Invoke-AzOrFail -Arguments @(
    'monitor', 'log-analytics', 'workspace', 'show',
    '--resource-group', $ResourceGroup,
    '--workspace-name', $LogAnalyticsName,
    '--query', 'id', '-o', 'tsv'
) -FailureMessage "Could not read the Log Analytics workspace id."

# ---------------------------------------------------------------------------
# 3. Application Insights
# ---------------------------------------------------------------------------
# `az resource list` avoids needing the application-insights extension for
# the existence check itself, and does not error when nothing matches.
$appiCount = (Invoke-Az -Arguments @(
    'resource', 'list',
    '--resource-group', $ResourceGroup,
    '--resource-type', 'microsoft.insights/components',
    '--query', "[?name=='$AppInsightsName'] | length(@)", '-o', 'tsv'
)).Output

if ($appiCount -eq '1') {
    Write-Host "[3/3] Application Insights $AppInsightsName exists"
} else {
    Write-Host "[3/3] Creating Application Insights $AppInsightsName"
    Invoke-AzOrFail -Arguments @(
        'monitor', 'app-insights', 'component', 'create',
        '--resource-group', $ResourceGroup,
        '--app', $AppInsightsName,
        '--location', $Location,
        '--kind', 'web',
        '--application-type', 'web',
        '--workspace', $WorkspaceId,
        '--output', 'none'
    ) -FailureMessage "Application Insights creation failed." | Out-Null
}

$ConnectionString = Invoke-AzOrFail -Arguments @(
    'monitor', 'app-insights', 'component', 'show',
    '--resource-group', $ResourceGroup, '--app', $AppInsightsName,
    '--query', 'connectionString', '-o', 'tsv'
) -FailureMessage "Could not read the Application Insights connection string."

$AppInsightsId = Invoke-AzOrFail -Arguments @(
    'monitor', 'app-insights', 'component', 'show',
    '--resource-group', $ResourceGroup, '--app', $AppInsightsName,
    '--query', 'id', '-o', 'tsv'
) -FailureMessage "Could not read the Application Insights resource id."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Azure Monitor resources are ready." -ForegroundColor Green
Write-Host ""
Write-Host "Add this to .env (it is a CREDENTIAL -- never commit it):"
Write-Host ""
Write-Host "APPLICATIONINSIGHTS_CONNECTION_STRING=$ConnectionString"
Write-Host ""
Write-Host "Then choose a backend and restart the collector:"
Write-Host ""
Write-Host "  # Azure Monitor only"
Write-Host "  `$env:OTEL_COLLECTOR_CONFIG='./otel-collector-config.azure.yaml'"
Write-Host "  docker compose up -d --force-recreate otel-collector"
Write-Host ""
Write-Host "  # Splunk and Azure Monitor in parallel"
Write-Host "  `$env:OTEL_COLLECTOR_CONFIG='./otel-collector-config.dual.yaml'"
Write-Host "  docker compose up -d --force-recreate otel-collector"
Write-Host ""
Write-Host "Then deploy the workbook and alert rules:"
Write-Host "  .\scripts\setup-azure-workbook.ps1"
Write-Host ""
Write-Host "Portal: https://portal.azure.com/#@/resource$AppInsightsId/overview"
Write-Host ""
Write-Host "NOTE: this connection string cannot be rotated. If it leaks, the"
Write-Host "remedy is a new Application Insights resource, which loses"
Write-Host "continuity of the data already ingested."
