# setup-docker-desktop-otel.ps1 -- Configure Docker Desktop to export
# OpenTelemetry data to the project's OTel Collector.
#
# Usage:
#   .\scripts\setup-docker-desktop-otel.ps1
#
# What it does:
#   1. Locates Docker Desktop's settings-store.json
#   2. Backs up the original file
#   3. Enables OTLP export with endpoint http://localhost:4318
#   4. Prompts you to restart Docker Desktop
#
# The script is idempotent -- it skips if already configured.
# Requires Docker Desktop 4.35+ for OTLP export support.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$OtelEndpoint = 'http://localhost:4318'
$OtelProtocol = 'http/protobuf'

# ---------------------------------------------------------------------------
# Locate settings-store.json
# ---------------------------------------------------------------------------
function Find-SettingsFile {
    # $IsWindows / $IsMacOS exist in PS 6+; PS 5.1 only runs on Windows.
    $isWin = if (Test-Path variable:IsWindows) { $IsWindows } else { $env:OS -eq 'Windows_NT' }
    $isMac = if (Test-Path variable:IsMacOS)   { $IsMacOS }   else { $false }

    if ($isWin) {
        $path = Join-Path (Join-Path $env:APPDATA 'Docker') 'settings-store.json'
    }
    elseif ($isMac) {
        $path = Join-Path (Join-Path (Join-Path (Join-Path $HOME 'Library') 'Group Containers') 'group.com.docker') 'settings-store.json'
    }
    else {
        # Linux
        $path = Join-Path (Join-Path (Join-Path $HOME '.docker') 'desktop') 'settings-store.json'
    }
    return $path
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Write-Host '=== Docker Desktop OTel Setup ==='
Write-Host ''

# Check Docker Desktop is installed
$dockerVersion = $null
try {
    $dockerVersion = docker version --format '{{.Client.Version}}' 2>$null
}
catch {}

if (-not $dockerVersion) {
    Write-Error 'Docker Desktop does not appear to be installed. Install it from https://docs.docker.com/get-docker/'
    exit 1
}
Write-Host "Docker version: $dockerVersion"

$settingsFile = Find-SettingsFile
$settingsDir = Split-Path -Parent $settingsFile

Write-Host "Settings file:  $settingsFile"
Write-Host ''

# ---------------------------------------------------------------------------
# Read or create settings
# ---------------------------------------------------------------------------
$settings = @{}

if (Test-Path $settingsFile) {
    $raw = Get-Content $settingsFile -Raw
    if ($raw) {
        $settings = $raw | ConvertFrom-Json
    }
}
else {
    Write-Host "Settings file does not exist yet -- will create it."
    if (-not (Test-Path $settingsDir)) {
        New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
    }
}

# ---------------------------------------------------------------------------
# Check if already configured
# ---------------------------------------------------------------------------
if ($settings.openTelemetry) {
    $current = $settings.openTelemetry
    if ($current.enabled -eq $true -and $current.endpoint -eq $OtelEndpoint) {
        Write-Host 'Docker Desktop OTLP export is already configured correctly.'
        Write-Host "  enabled:  $($current.enabled)"
        Write-Host "  endpoint: $($current.endpoint)"
        Write-Host "  protocol: $($current.protocol)"
        Write-Host ''
        Write-Host 'No changes needed. If telemetry is not appearing, restart Docker Desktop.'
        exit 0
    }

    if ($current.enabled -eq $true -and $current.endpoint -ne $OtelEndpoint) {
        Write-Host "WARNING: OTLP export is already enabled but pointing to a different endpoint:"
        Write-Host "  Current:  $($current.endpoint)"
        Write-Host "  Expected: $OtelEndpoint"
        Write-Host ''
        $response = Read-Host 'Overwrite with the project endpoint? (y/N)'
        if ($response -ne 'y' -and $response -ne 'Y') {
            Write-Host 'Aborted. No changes made.'
            exit 0
        }
    }
}

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
if (Test-Path $settingsFile) {
    $backupFile = "$settingsFile.bak"
    Copy-Item $settingsFile $backupFile -Force
    Write-Host "Backed up to: $backupFile"
}

# ---------------------------------------------------------------------------
# Update settings
# ---------------------------------------------------------------------------
# PowerShell's ConvertFrom-Json returns PSCustomObject; we need to handle
# both cases (existing object or fresh hashtable).
if ($settings -is [hashtable]) {
    $settings['openTelemetry'] = @{
        enabled  = $true
        endpoint = $OtelEndpoint
        protocol = $OtelProtocol
    }
}
else {
    # PSCustomObject from ConvertFrom-Json
    if ($settings.PSObject.Properties['openTelemetry']) {
        $settings.openTelemetry = [PSCustomObject]@{
            enabled  = $true
            endpoint = $OtelEndpoint
            protocol = $OtelProtocol
        }
    }
    else {
        $settings | Add-Member -NotePropertyName 'openTelemetry' -NotePropertyValue ([PSCustomObject]@{
            enabled  = $true
            endpoint = $OtelEndpoint
            protocol = $OtelProtocol
        })
    }
}

$json = $settings | ConvertTo-Json -Depth 10
Set-Content -Path $settingsFile -Value $json -Encoding UTF8

Write-Host ''
Write-Host 'Docker Desktop settings updated:'
Write-Host "  openTelemetry.enabled:  true"
Write-Host "  openTelemetry.endpoint: $OtelEndpoint"
Write-Host "  openTelemetry.protocol: $OtelProtocol"
Write-Host ''
Write-Host '=== ACTION REQUIRED ==='
Write-Host ''
Write-Host 'Restart Docker Desktop for the changes to take effect.'
Write-Host 'After restarting, verify with:'
Write-Host ''
Write-Host '  docker compose logs otel-collector | Select-String "docker-desktop"'
Write-Host ''
Write-Host 'You should see container metrics (container.cpu.usage, container.memory.usage)'
Write-Host 'flowing through the collector within a few minutes.'
