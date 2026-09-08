# setup-splunk-hec.ps1 -- Validate and activate the Splunk Cloud Platform
# HEC logs pipeline for the OTel Collector.
#
# Usage:
#   .\scripts\setup-splunk-hec.ps1
#
# Prerequisites:
#   - SPLUNK_HEC_URL, SPLUNK_HEC_TOKEN, SPLUNK_HEC_INDEX,
#     SPLUNK_HEC_SOURCETYPE set in .env (see .env.example)
#   - A HEC token already created in Splunk Web (Settings > Add Data >
#     Monitor > HTTP Event Collector) -- this script does not create the
#     token, it only validates one and wires it up. See docs/splunk-setup.md
#   - PowerShell 5.1+ (Windows) or PowerShell 7+ (cross-platform)
#   - docker compose installed and this repo's stack buildable
#
# What this script does:
#   1. Loads .env and checks the four HEC variables are set
#   2. Sends one test event straight to the HEC endpoint to confirm the
#      token/URL/index actually work, before touching Docker
#   3. Rebuilds and restarts the otel-collector service
#   4. Tails its logs briefly so you can see the logs pipeline exporting
#      cleanly (or spot an auth/endpoint error immediately)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# ---------------------------------------------------------------------------
# Load .env if present. Always overwrites the process-scoped env var with
# the current .env value -- this script is meant to be edited-and-rerun
# in the same shell session while troubleshooting, and a "don't override
# already-set vars" guard here would silently keep serving a stale value
# from a previous run in that same session instead of your latest edit.
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
                # Strip an inline trailing comment, then surrounding
                # quotes -- docker compose does both when it reads .env,
                # so without this a quoted token would work for the
                # collector but 401 here, which misleads the diagnostics.
                if ($val -match '\s+#') {
                    $val = ($val -split '\s+#', 2)[0].Trim()
                }
                if ($val.Length -ge 2 -and
                    (($val.StartsWith('"') -and $val.EndsWith('"')) -or
                     ($val.StartsWith("'") -and $val.EndsWith("'")))) {
                    $val = $val.Substring(1, $val.Length - 2)
                }
                if ($key -like 'SPLUNK_HEC_*') {
                    [System.Environment]::SetEnvironmentVariable($key, $val)
                }
                elseif (-not [System.Environment]::GetEnvironmentVariable($key)) {
                    [System.Environment]::SetEnvironmentVariable($key, $val)
                }
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Validate required variables
# ---------------------------------------------------------------------------
$HecUrl = [System.Environment]::GetEnvironmentVariable('SPLUNK_HEC_URL')
$HecToken = [System.Environment]::GetEnvironmentVariable('SPLUNK_HEC_TOKEN')
$HecIndex = [System.Environment]::GetEnvironmentVariable('SPLUNK_HEC_INDEX')
$HecSourcetype = [System.Environment]::GetEnvironmentVariable('SPLUNK_HEC_SOURCETYPE')

# Write-Host, not Write-Error: $ErrorActionPreference='Stop' makes
# Write-Error terminating, which would abort on the first missing
# variable and never report the rest.
$Missing = @()
if (-not $HecUrl) { $Missing += 'SPLUNK_HEC_URL' }
if (-not $HecToken) { $Missing += 'SPLUNK_HEC_TOKEN' }
if (-not $HecIndex) { $Missing += 'SPLUNK_HEC_INDEX' }
if (-not $HecSourcetype) { $Missing += 'SPLUNK_HEC_SOURCETYPE' }

if ($Missing.Count -gt 0) {
    Write-Host 'ERROR: required variables are not set in .env (see .env.example):'
    foreach ($name in $Missing) {
        Write-Host "  - $name"
    }
    exit 1
}

$SkipCertCheck = ([System.Environment]::GetEnvironmentVariable('SPLUNK_HEC_INSECURE_SKIP_VERIFY') -eq 'true')

Write-Host '=== Splunk Cloud Platform HEC Setup ==='
Write-Host "Endpoint: $HecUrl"
Write-Host "Index:    $HecIndex"
if ($SkipCertCheck) {
    Write-Host 'TLS:      certificate verification DISABLED (SPLUNK_HEC_INSECURE_SKIP_VERIFY=true)'
}
Write-Host ''

# ---------------------------------------------------------------------------
# Step 1: Send a test event directly to HEC
# ---------------------------------------------------------------------------
Write-Host '--- Step 1: Test HEC connectivity ---'

$TestBody = @{
    event      = 'otel-collector HEC connectivity test'
    sourcetype = $HecSourcetype
    index      = $HecIndex
    source     = 'setup-splunk-hec-script'
} | ConvertTo-Json -Compress

$Headers = @{
    'Authorization' = "Splunk $HecToken"
    'Content-Type'  = 'application/json'
}

# Saved so the 5.1 fallback below can be undone. Leaving a
# trust-everything policy installed would silently disable certificate
# validation for every later HTTPS call in the same PowerShell session.
$OriginalCertPolicy = [System.Net.ServicePointManager]::CertificatePolicy

try {
    $InvokeParams = @{
        Uri     = $HecUrl
        Method  = 'Post'
        Headers = $Headers
        Body    = ([System.Text.Encoding]::UTF8.GetBytes($TestBody))
    }

    if ($SkipCertCheck) {
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            # PowerShell 7+ supports this per-request, no global state.
            $InvokeParams['SkipCertificateCheck'] = $true
        }
        else {
            # Windows PowerShell 5.1 has no -SkipCertificateCheck, so the
            # only lever is the process-wide policy. Restored in the
            # finally block below. Only for a known self-signed cert (e.g.
            # an unprovisioned Splunk trial's SplunkServerDefaultCert),
            # never production.
            if (-not ('TrustAllCertsPolicy' -as [type])) {
                Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCertsPolicy : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) {
        return true;
    }
}
"@
            }
            [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsPolicy
        }
    }

    $response = Invoke-RestMethod @InvokeParams
    Write-Host "Test event accepted: $($response | ConvertTo-Json -Compress)"
}
catch {
    # $_.Exception.Response is $null for connection-level failures (DNS,
    # TLS, timeout, refused) as opposed to an HTTP error status from
    # Splunk -- guard every access so a network failure doesn't get
    # masked by a second, unrelated "property not found" error here.
    $webResponse = $null
    if ($_.Exception -and ($_.Exception.PSObject.Properties.Name -contains 'Response')) {
        $webResponse = $_.Exception.Response
    }

    $statusCode = $null
    $responseBody = $null
    if ($webResponse) {
        try { $statusCode = [int]$webResponse.StatusCode } catch {}
    }
    # Prefer PowerShell's own captured error body -- in Windows PowerShell
    # 5.1, the response stream is often already consumed by the time the
    # catch block runs, so re-reading GetResponseStream() here silently
    # returns nothing. $_.ErrorDetails.Message is populated separately and
    # reliably holds the body text.
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $responseBody = $_.ErrorDetails.Message
    }
    elseif ($webResponse) {
        try {
            $stream = $webResponse.GetResponseStream()
            if ($stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                $responseBody = $reader.ReadToEnd()
            }
        } catch {}
    }

    Write-Host ''
    Write-Host 'ERROR: HEC test event failed.'
    if ($statusCode) {
        Write-Host "HTTP status: $statusCode"
        if ($responseBody) { Write-Host "Response body: $responseBody" }
    }
    else {
        Write-Host 'No HTTP response was received -- the request failed before reaching Splunk.'
        Write-Host "Underlying error: $($_.Exception.Message)"
    }

    Write-Host ''
    Write-Host 'Debug guidance:'
    Write-Host '  HTTP 404 -- wrong host. Splunk Cloud HEC uses a dedicated ingest'
    Write-Host '              hostname, not your Splunk Web hostname:'
    Write-Host '                https://http-inputs-<stack>.splunkcloud.com/services/collector'
    Write-Host '  HTTP 400 -- malformed request, or SPLUNK_HEC_INDEX does not exist or is'
    Write-Host '              not in this token''s allowed indexes list.'
    Write-Host '  HTTP 401 -- invalid or revoked token. Check SPLUNK_HEC_TOKEN.'
    Write-Host '  HTTP 403 -- token disabled, or HEC is disabled globally on this stack'
    Write-Host '              (Splunk Web: Settings > Data Inputs > HTTP Event Collector >'
    Write-Host '              Global Settings -- confirm "All Tokens" is Enabled).'
    Write-Host '  No HTTP status, message mentions "could not be resolved" --'
    Write-Host '              DNS lookup failed. Re-check the stack name in SPLUNK_HEC_URL'
    Write-Host '              character-for-character against your Splunk Cloud stack.'
    Write-Host '  No HTTP status, message mentions "Unable to connect" or a timeout --'
    Write-Host '              Outbound network/firewall/proxy is blocking access to'
    Write-Host '              *.splunkcloud.com on port 443 from this machine.'
    Write-Host '  SSL/TLS or certificate errors --'
    Write-Host '              Check the system clock is correct (cert validation fails on a'
    Write-Host '              wrong clock), and whether a corporate TLS-inspecting proxy is'
    Write-Host '              intercepting the connection.'
    [System.Net.ServicePointManager]::CertificatePolicy = $OriginalCertPolicy
    exit 1
}
finally {
    # Undo the 5.1 process-wide override so certificate validation is not
    # left disabled for the rest of this PowerShell session.
    [System.Net.ServicePointManager]::CertificatePolicy = $OriginalCertPolicy
}

Write-Host ''

# ---------------------------------------------------------------------------
# Step 2: Rebuild and restart the collector
# ---------------------------------------------------------------------------
Write-Host '--- Step 2: Redeploy otel-collector ---'
Push-Location $ProjectRoot
try {
    docker compose up -d --build otel-collector
}
finally {
    Pop-Location
}
Write-Host ''

# ---------------------------------------------------------------------------
# Step 3: Tail logs for a quick sanity check
# ---------------------------------------------------------------------------
Write-Host '--- Step 3: Recent otel-collector logs ---'
Push-Location $ProjectRoot
try {
    docker compose logs --tail=30 otel-collector
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host '=== Setup complete ==='
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Generate a chat message through the app to produce log traffic.'
Write-Host "  2. In Splunk Cloud Platform Search, run: index=$HecIndex sourcetype=$HecSourcetype"
Write-Host '  3. Set up Log Observer Connect (Splunk admin console, see docs/splunk-setup.md)'
Write-Host '     to correlate these logs with traces in Observability Cloud.'
