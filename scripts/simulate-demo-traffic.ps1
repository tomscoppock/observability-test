# simulate-demo-traffic.ps1 -- Generate realistic traffic for the RAG Agent
# stack so Splunk APM has data for the demo (service map colours, dashboard
# charts, distributed traces).
#
# Usage:
#   .\scripts\simulate-demo-traffic.ps1 [-BaseUrl http://localhost] [-Rounds 2] [-NoErrors]
#
# Options:
#   -BaseUrl    Base URL of the stack (default: http://localhost)
#   -Rounds     Number of rounds (default: 2, each ~3-4 min)
#   -NoErrors   Skip deliberate error traffic (keeps service map green)
#
# Requires: PowerShell 5.1+ (Invoke-WebRequest)

param(
    [string]$BaseUrl = "http://localhost",
    [int]$Rounds = 2,
    [switch]$NoErrors
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SampleDir = Join-Path (Split-Path -Parent $ScriptDir) "sample-docs"

# Session IDs for simulated users
$epoch = [int][double]::Parse((Get-Date -UFormat %s))
$SessionA = "demo-alice-$epoch"
$SessionB = "demo-bob-$epoch"
$SessionC = "demo-carol-$epoch"

$IncludeErrors = -not $NoErrors

# Chat messages -- 20 varied questions aligned to sample docs
$ChatMessages = @(
    "What is the company leave policy?"
    "How many days of annual leave do employees get?"
    "What is the remote work policy?"
    "Can I work from home on Fridays?"
    "What are the rules for claiming expenses?"
    "Is there a limit on meal expenses when travelling?"
    "What does the code of conduct say about conflicts of interest?"
    "How is personal data protected under the data protection policy?"
    "What happens if I breach the code of conduct?"
    "Can I carry over unused leave to the next year?"
    "What equipment does the company provide for remote workers?"
    "How do I request parental leave?"
    "What is the policy on gifts and hospitality?"
    "How long must I retain expense receipts?"
    "What are the data breach notification procedures?"
    "Can I work remotely from another country?"
    "What is the disciplinary process for misconduct?"
    "How do I report a data protection concern?"
    "What types of leave are available besides annual leave?"
    "Summarise the key points across all company policies"
)

# Scrape URLs -- safe, public, reliable sites
$ScrapeUrls = @(
    "https://example.com"
    "https://httpbin.org/html"
    "https://www.w3.org/TR/WCAG21/"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Log($msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor Cyan
}

function Ok($msg) {
    Write-Host "  OK $msg" -ForegroundColor Green
}

function Warn($msg) {
    Write-Host "  WARN $msg" -ForegroundColor Yellow
}

function Err($msg) {
    Write-Host "  ERROR $msg" -ForegroundColor Red
}

function Phase($msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] === $msg ===" -ForegroundColor DarkCyan
}

function Test-Health {
    Log "Checking API health at $BaseUrl/health ..."
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Ok "API is healthy"
            return $true
        }
    } catch {
        # fall through
    }
    Err "API is not reachable. Is the stack running?"
    Err "Start with: docker compose up -d"
    return $false
}

function Send-Upload {
    param([string]$FilePath, [string]$Session)
    $filename = Split-Path -Leaf $FilePath
    Log "  Uploading $filename ..."
    try {
        # PS 5.1 compatible multipart upload (no -Form parameter)
        Add-Type -AssemblyName System.Net.Http
        $client = New-Object System.Net.Http.HttpClient
        $client.DefaultRequestHeaders.Add("X-Session-Id", $Session)
        $content = New-Object System.Net.Http.MultipartFormDataContent
        $fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
        $fileContent = New-Object System.Net.Http.ByteArrayContent($fileBytes)
        $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/octet-stream")
        $content.Add($fileContent, "files", $filename)
        $response = $client.PostAsync("$BaseUrl/api/upload", $content).Result
        $statusCode = [int]$response.StatusCode
        $client.Dispose()
        if ($statusCode -eq 200 -or $statusCode -eq 201) {
            Ok "$filename uploaded (HTTP $statusCode)"
        } else {
            Warn "$filename upload returned HTTP $statusCode"
        }
    } catch {
        Warn "$filename upload failed: $($_.Exception.Message)"
    }
}

function Send-Chat {
    param([string]$Session, [string]$Message)
    $user = ($Session -replace 'demo-','') -replace '-.*',''
    Log "  [$user] `"$Message`""
    try {
        $body = @{ message = $Message } | ConvertTo-Json
        $headers = @{
            "Content-Type" = "application/json"
            "X-Session-Id" = $Session
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/chat" `
            -Method Post -Body $body -Headers $headers `
            -UseBasicParsing -TimeoutSec 120
        Ok "Response received"
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "N/A" }
        Warn "Chat returned HTTP $status"
    }
}

function Send-Scrape {
    param([string]$Url, [string]$Session)
    Log "  Scraping $Url ..."
    try {
        $body = @{ url = $Url } | ConvertTo-Json
        $headers = @{
            "Content-Type" = "application/json"
            "X-Session-Id" = $Session
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/scrape" `
            -Method Post -Body $body -Headers $headers `
            -UseBasicParsing -TimeoutSec 120
        Ok "Scrape completed"
        return $true
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "N/A" }
        if ($status -eq 503) {
            Warn "MCP not configured -- skipping (set MCP_PLAYWRIGHT_URL in .env)"
            return $false
        } else {
            Warn "Scrape returned HTTP $status"
            return $true
        }
    }
}

function Send-Error {
    param([string]$Message, [string]$Session)
    Log "  Triggering error: $Message"
    try {
        $body = @{ message = $Message } | ConvertTo-Json
        $headers = @{
            "Content-Type" = "application/json"
            "X-Session-Id" = $Session
        }
        Invoke-WebRequest -Uri "$BaseUrl/api/test-error" `
            -Method Post -Body $body -Headers $headers `
            -UseBasicParsing -TimeoutSec 10 | Out-Null
    } catch {
        # Expected -- test-error returns 500
    }
    Ok "Error recorded"
}

function Hit-Health {
    try {
        Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
    } catch {
        # ignore
    }
}

function Get-RandomDelay {
    param([int]$Min, [int]$Max)
    $delay = Get-Random -Minimum $Min -Maximum ($Max + 1)
    Start-Sleep -Seconds $delay
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "==============================================" -ForegroundColor White
Write-Host "  RAG Agent -- Demo Traffic Simulator" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor White
Write-Host ""
Log "Base URL:  $BaseUrl"
Log "Rounds:    $Rounds"
Log "Errors:    $IncludeErrors"
Log "Sessions:  Alice=$SessionA"
Log "           Bob=$SessionB"
Log "           Carol=$SessionC"
Write-Host ""

# Pre-flight check
if (-not (Test-Health)) { exit 1 }
Write-Host ""

# Check MCP configuration
Log "Checking MCP (Playwright) availability ..."
$McpAvailable = $true
try {
    $body = @{ url = "https://example.com" } | ConvertTo-Json
    $headers = @{ "Content-Type" = "application/json" }
    Invoke-WebRequest -Uri "$BaseUrl/api/scrape" `
        -Method Post -Body $body -Headers $headers `
        -UseBasicParsing -TimeoutSec 30 | Out-Null
    Ok "MCP appears configured"
} catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($status -eq 503) {
        $McpAvailable = $false
        Warn "MCP Playwright is NOT configured."
        Warn "To see the Playwright node on the service map, set in .env:"
        Warn "  MCP_PLAYWRIGHT_URL=http://host.docker.internal:8100/mcp"
        Warn "  MCP_PLAYWRIGHT_API_KEY=<your-key>"
        Warn "Scrape phases will be skipped."
    } else {
        Ok "MCP appears configured (HTTP $status)"
    }
}
Write-Host ""

$sessions = @($SessionA, $SessionB, $SessionC)

for ($round = 1; $round -le $Rounds; $round++) {
    Write-Host ""
    Write-Host "----------------------------------------------" -ForegroundColor White
    Phase "Round $round of $Rounds"
    Write-Host "----------------------------------------------" -ForegroundColor White
    Write-Host ""

    # Phase 1: Upload sample documents (first round only)
    if ($round -eq 1) {
        Phase "Phase 1: Uploading sample documents"
        $sampleFiles = Get-ChildItem -Path $SampleDir -Filter "*.txt" -ErrorAction SilentlyContinue
        foreach ($f in $sampleFiles) {
            Send-Upload -FilePath $f.FullName -Session $SessionA
            Start-Sleep -Seconds 1
        }
        Ok "Phase 1 complete -- documents uploaded"
        Write-Host ""
    }

    # Phase 2: Chat traffic (multiple sessions, varied delays)
    Phase "Phase 2: Chat traffic ($($ChatMessages.Count) messages)"
    for ($i = 0; $i -lt $ChatMessages.Count; $i++) {
        $sessionIdx = $i % 3
        $session = $sessions[$sessionIdx]
        Send-Chat -Session $session -Message $ChatMessages[$i]
        Hit-Health
        Get-RandomDelay -Min 3 -Max 8
    }
    Ok "Phase 2 complete -- chat traffic generated"
    Write-Host ""

    # Phase 3: Scrape traffic (skip if MCP not available)
    Phase "Phase 3: Web scrape traffic"
    if ($McpAvailable) {
        foreach ($url in $ScrapeUrls) {
            $result = Send-Scrape -Url $url -Session $SessionB
            if (-not $result) {
                $McpAvailable = $false
                Warn "MCP became unavailable -- skipping remaining scrapes"
                break
            }
            Start-Sleep -Seconds 3
        }
        if ($McpAvailable) { Ok "Phase 3 complete" }
    } else {
        Warn "Skipping -- MCP not configured"
    }
    Write-Host ""

    # Phase 4: Error traffic (optional -- controlled by -NoErrors switch)
    Phase "Phase 4: Error traffic"
    if ($IncludeErrors) {
        Send-Error -Message "Simulated timeout for demo" -Session $SessionC
        Start-Sleep -Seconds 1
        Send-Error -Message "Simulated validation failure" -Session $SessionA
        Start-Sleep -Seconds 1
        Send-Error -Message "Simulated upstream error" -Session $SessionB
        Start-Sleep -Seconds 1
        Send-Error -Message "Simulated rate limit exceeded" -Session $SessionC
        Ok "Phase 4 complete -- errors recorded"
    } else {
        Log "Skipping error traffic (-NoErrors flag set)"
        Log "Service map will show green nodes (0% error rate)"
    }
    Write-Host ""

    # Phase 5: Cool-down (more successful requests to settle error rate)
    Phase "Phase 5: Cool-down -- successful requests"
    Send-Chat -Session $SessionA -Message "Summarise the key points of the leave policy"
    Hit-Health
    Start-Sleep -Seconds 3
    Send-Chat -Session $SessionB -Message "What are the main data protection principles?"
    Hit-Health
    Start-Sleep -Seconds 3
    Send-Chat -Session $SessionC -Message "How do I submit an expense claim?"
    Hit-Health
    Start-Sleep -Seconds 3
    Send-Chat -Session $SessionA -Message "What is the notice period for resignation?"
    Hit-Health
    Start-Sleep -Seconds 3
    Send-Chat -Session $SessionB -Message "Explain the whistleblowing procedure"
    Ok "Phase 5 complete"
    Write-Host ""

    if ($round -lt $Rounds) {
        Log "Pausing 10s before next round ..."
        Start-Sleep -Seconds 10
    }
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor White
Write-Host "  Simulation complete!" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor White
Write-Host ""
Log "Total rounds: $Rounds"
Log "Error traffic: $IncludeErrors"
Write-Host ""
Log "Open Splunk Observability Cloud and set the time picker to"
Log "'Last 15 minutes' to see the generated data."
Write-Host ""
Log "Session IDs for trace filtering in Splunk Tag Spotlight:"
Log "  Alice: $SessionA"
Log "  Bob:   $SessionB"
Log "  Carol: $SessionC"
Write-Host ""
if (-not $McpAvailable) {
    Warn "Playwright MCP was not configured -- no scrape traffic was generated."
    Warn "To include it, set MCP_PLAYWRIGHT_URL in .env and re-run."
    Write-Host ""
}
