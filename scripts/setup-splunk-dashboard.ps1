# setup-splunk-dashboard.ps1 -- Create the RAG Agent demo dashboard in
# Splunk Observability Cloud via the REST API.
#
# Usage:
#   .\scripts\setup-splunk-dashboard.ps1
#
# Prerequisites:
#   - SPLUNK_ACCESS_TOKEN and SPLUNK_REALM set in .env (or as env vars)
#   - PowerShell 5.1+ (Windows) or PowerShell 7+ (cross-platform)
#
# The script is idempotent: it checks for existing resources before
# creating new ones. Re-running updates chart programs in place.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$DashboardJson = Join-Path (Join-Path $ProjectRoot 'splunk') 'dashboard.json'

# ---------------------------------------------------------------------------
# Load .env if present (does not override already-set env vars)
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
                if (-not [System.Environment]::GetEnvironmentVariable($key)) {
                    [System.Environment]::SetEnvironmentVariable($key, $val)
                }
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Validate required variables
# ---------------------------------------------------------------------------
$SplunkToken = [System.Environment]::GetEnvironmentVariable('SPLUNK_ACCESS_TOKEN')
$SplunkRealm = [System.Environment]::GetEnvironmentVariable('SPLUNK_REALM')

if (-not $SplunkToken) {
    Write-Error 'SPLUNK_ACCESS_TOKEN is not set. Set it in .env or as an environment variable.'
    exit 1
}

if (-not $SplunkRealm) {
    Write-Error 'SPLUNK_REALM is not set. Set it in .env or as an environment variable.'
    exit 1
}

if (-not (Test-Path $DashboardJson)) {
    Write-Error "Dashboard definition not found at $DashboardJson"
    exit 1
}

$ApiBase = "https://api.$SplunkRealm.signalfx.com"
$Headers = @{
    'X-SF-Token'   = $SplunkToken
    'Content-Type' = 'application/json'
}

# ---------------------------------------------------------------------------
# Helper: make an API call with error handling
# ---------------------------------------------------------------------------
function Invoke-SplunkApi {
    param(
        [string]$Method,
        [string]$Endpoint,
        [string]$Body = $null
    )

    $url = "$ApiBase$Endpoint"
    $params = @{
        Uri     = $url
        Method  = $Method
        Headers = $Headers
    }

    if ($Body) {
        $params['Body'] = [System.Text.Encoding]::UTF8.GetBytes($Body)
    }

    try {
        $response = Invoke-RestMethod @params
        return $response
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Error "API returned HTTP $statusCode for $Method $Endpoint : $_"
        throw
    }
}

# ---------------------------------------------------------------------------
# Read dashboard definition
# ---------------------------------------------------------------------------
$Config = Get-Content $DashboardJson -Raw | ConvertFrom-Json

$GroupName = $Config.dashboardGroup.name
$GroupDesc = $Config.dashboardGroup.description
$DashName  = $Config.dashboard.name
$DashDesc  = $Config.dashboard.description

Write-Host '=== Splunk Dashboard Setup ==='
Write-Host "Realm:           $SplunkRealm"
Write-Host "Dashboard group: $GroupName"
Write-Host "Dashboard:       $DashName"
Write-Host ''

# ---------------------------------------------------------------------------
# Step 1: Find or create dashboard group
# ---------------------------------------------------------------------------
Write-Host '--- Step 1: Dashboard group ---'

$GroupId = $null
$groupsResponse = Invoke-SplunkApi -Method GET -Endpoint '/v2/dashboardgroup?limit=100'
if ($groupsResponse.results) {
    $existing = $groupsResponse.results | Where-Object { $_.name -eq $GroupName } | Select-Object -First 1
    if ($existing) {
        $GroupId = $existing.id
    }
}

if ($GroupId) {
    Write-Host "Found existing dashboard group: $GroupId"
}
else {
    Write-Host "Creating dashboard group: $GroupName"
    $groupBody = @{ name = $GroupName; description = $GroupDesc } | ConvertTo-Json -Compress
    $groupResponse = Invoke-SplunkApi -Method POST -Endpoint '/v2/dashboardgroup' -Body $groupBody
    $GroupId = $groupResponse.id
    Write-Host "Created dashboard group: $GroupId"
}

# ---------------------------------------------------------------------------
# Step 2: Find or create dashboard
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '--- Step 2: Dashboard ---'

$DashId = $null
$dashList = Invoke-SplunkApi -Method GET -Endpoint "/v2/dashboard?limit=100&groupId=$GroupId"
if ($dashList.results) {
    $existingDash = $dashList.results | Where-Object { $_.name -eq $DashName } | Select-Object -First 1
    if ($existingDash) {
        $DashId = $existingDash.id
    }
}

if ($DashId) {
    Write-Host "Found existing dashboard: $DashId"
}
else {
    Write-Host "Creating dashboard: $DashName"
    $dashBody = @{
        name        = $DashName
        description = $DashDesc
        groupId     = $GroupId
        charts      = @()
    } | ConvertTo-Json -Compress
    $dashResponse = Invoke-SplunkApi -Method POST -Endpoint '/v2/dashboard' -Body $dashBody
    $DashId = $dashResponse.id
    Write-Host "Created dashboard: $DashId"
}

# ---------------------------------------------------------------------------
# Step 3: Create or update charts
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '--- Step 3: Charts ---'

# Build a map of chart names already on our target dashboard so we only
# update those (not charts with the same name on other dashboards).
$currentDashForCharts = Invoke-SplunkApi -Method GET -Endpoint "/v2/dashboard/$DashId"
$dashChartMap = @{}
if ($currentDashForCharts.charts) {
    foreach ($dc in $currentDashForCharts.charts) {
        try {
            $chartDetail = Invoke-SplunkApi -Method GET -Endpoint "/v2/chart/$($dc.chartId)"
            $dashChartMap[$chartDetail.name] = $dc.chartId
        }
        catch {
            # Chart may have been deleted; skip
        }
    }
}

$ChartIds = @()
$chartCount = $Config.charts.Count

for ($i = 0; $i -lt $chartCount; $i++) {
    $chart = $Config.charts[$i]
    $chartName = $chart.name
    $chartDesc = $chart.description
    $chartType = $chart.chartType
    $programText = $chart.programText

    # Map chart types to Splunk API options.type values
    # Valid types: Event, Heatmap, List, SingleValue, Text, TimeSeriesChart
    $plotType = switch ($chartType) {
        'Line'        { 'TimeSeriesChart' }
        'Area'        { 'TimeSeriesChart' }
        'List'        { 'List' }
        'SingleValue' { 'SingleValue' }
        default       { 'TimeSeriesChart' }
    }

    # For Area charts, set the default plot type inside options
    $optionsObj = @{ type = $plotType }
    if ($chartType -eq 'Area') {
        $optionsObj['defaultPlotType'] = 'AreaChart'
    }

    $chartBody = @{
        name        = $chartName
        description = $chartDesc
        programText = $programText
        options     = $optionsObj
    } | ConvertTo-Json -Compress -Depth 3

    # Only update charts already on THIS dashboard (not other dashboards)
    if ($dashChartMap.ContainsKey($chartName)) {
        $existingChartId = $dashChartMap[$chartName]
        Write-Host "  Updating chart [$($i + 1)/$chartCount]: $chartName ($existingChartId)"
        Invoke-SplunkApi -Method PUT -Endpoint "/v2/chart/$existingChartId" -Body $chartBody | Out-Null
        $ChartIds += $existingChartId
    }
    else {
        Write-Host "  Creating chart [$($i + 1)/$chartCount]: $chartName"
        $chartResponse = Invoke-SplunkApi -Method POST -Endpoint '/v2/chart' -Body $chartBody
        $ChartIds += $chartResponse.id
    }

    # Brief pause to respect rate limits
    Start-Sleep -Milliseconds 200
}

# ---------------------------------------------------------------------------
# Step 4: Attach charts to dashboard
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '--- Step 4: Attach charts to dashboard ---'

# Read the current dashboard to get any existing chart attachments
$currentDash = Invoke-SplunkApi -Method GET -Endpoint "/v2/dashboard/$DashId"
$existingChartIds = @()
if ($currentDash.charts) {
    $existingChartIds = $currentDash.charts | ForEach-Object { $_.chartId }
}

$chartsArray = @()
$row = 0
$col = 0

# Keep existing chart positions
if ($currentDash.charts) {
    foreach ($ec in $currentDash.charts) {
        $chartsArray += @{
            chartId = $ec.chartId
            row     = $ec.row
            column  = $ec.column
            height  = $ec.height
            width   = $ec.width
        }
        # Track the next available row/col
        $endCol = $ec.column + $ec.width
        $endRow = $ec.row + $ec.height
        if ($endRow -gt $row -or ($endRow -eq $row -and $endCol -gt $col)) {
            $row = $ec.row
            $col = $endCol
            if ($col -ge 12) {
                $col = 0
                $row++
            }
        }
    }
    # Start new charts on the next row after existing ones
    if ($chartsArray.Count -gt 0) {
        $maxRow = ($chartsArray | ForEach-Object { $_.row }) | Measure-Object -Maximum | Select-Object -ExpandProperty Maximum
        $row = $maxRow + 1
        $col = 0
    }
}

# Add only charts not already on this dashboard
$added = 0
foreach ($cid in $ChartIds) {
    if ($existingChartIds -contains $cid) {
        continue
    }
    $chartsArray += @{
        chartId = $cid
        row     = $row
        column  = $col
        height  = 1
        width   = 6
    }
    $added++
    $col += 6
    if ($col -ge 12) {
        $col = 0
        $row++
    }
}

$dashUpdate = @{
    name        = $DashName
    description = $DashDesc
    groupId     = $GroupId
    charts      = $chartsArray
} | ConvertTo-Json -Compress -Depth 4

Invoke-SplunkApi -Method PUT -Endpoint "/v2/dashboard/$DashId" -Body $dashUpdate | Out-Null
Write-Host "Dashboard has $($chartsArray.Count) charts ($added newly attached)."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '=== Setup complete ==='
Write-Host ''
Write-Host 'Dashboard URL:'
Write-Host "  https://app.$SplunkRealm.signalfx.com/#/dashboard/$DashId"
Write-Host ''
Write-Host "Dashboard group: $GroupId"
Write-Host "Dashboard:       $DashId"
Write-Host "Charts:          $($ChartIds.Count)"
