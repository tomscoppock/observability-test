# simulate-demo-traffic.ps1 -- Generate realistic traffic for the RAG Agent
# stack so Splunk APM has data for the demo (service map colours, dashboard
# charts, distributed traces).
#
# Usage:
#   .\scripts\simulate-demo-traffic.ps1 [-BaseUrl http://localhost]
#
# Requires: PowerShell 5.1+ (Invoke-RestMethod, Invoke-WebRequest)

param(
    [string]$BaseUrl = "http://localhost"
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SampleDir = Join-Path (Split-Path -Parent $ScriptDir) "sample-docs"

# Session IDs for simulated users
$epoch = [int][double]::Parse((Get-Date -UFormat %s))
$SessionA = "demo-user-alice-$epoch"
$SessionB = "demo-user-bob-$epoch"
$SessionC = "demo-user-carol-$epoch"

# Chat messages aligned to talk track sections
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
)

# Scrape URLs (used if MCP is configured)
$ScrapeUrls = @("https://example.com")

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
    Log "  [$Session] `"$Message`""
    try {
        $body = @{ message = $Message } | ConvertTo-Json
        $headers = @{
            "Content-Type" = "application/json"
            "X-Session-Id" = $Session
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/chat" `
            -Method Post -Body $body -Headers $headers `
            -UseBasicParsing -TimeoutSec 120
        Ok "Chat response received"
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
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "N/A" }
        if ($status -eq 503) {
            Warn "MCP server not configured -- skipping scrape"
        } else {
            Warn "Scrape returned HTTP $status"
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
Log "Base URL: $BaseUrl"
Log "Sessions: $SessionA, $SessionB, $SessionC"
Write-Host ""

# Pre-flight check
if (-not (Test-Health)) { exit 1 }
Write-Host ""

# Phase 1: Upload sample documents
Log "Phase 1: Uploading sample documents ..."
$sampleFiles = Get-ChildItem -Path $SampleDir -Filter "*.txt" -ErrorAction SilentlyContinue
foreach ($f in $sampleFiles) {
    Send-Upload -FilePath $f.FullName -Session $SessionA
    Start-Sleep -Seconds 2
}
Ok "Phase 1 complete -- documents uploaded"
Write-Host ""

# Phase 2: Chat traffic (multiple sessions, varied delays)
Log "Phase 2: Sending chat messages (this takes ~2 minutes) ..."
$sessions = @($SessionA, $SessionB, $SessionC)
for ($i = 0; $i -lt $ChatMessages.Count; $i++) {
    $sessionIdx = $i % 3
    $session = $sessions[$sessionIdx]
    Send-Chat -Session $session -Message $ChatMessages[$i]
    Get-RandomDelay -Min 5 -Max 12
}
Ok "Phase 2 complete -- chat traffic generated"
Write-Host ""

# Phase 3: Scrape traffic (skip if MCP not available)
Log "Phase 3: Web scrape traffic ..."
foreach ($url in $ScrapeUrls) {
    Send-Scrape -Url $url -Session $SessionB
    Start-Sleep -Seconds 3
}
Ok "Phase 3 complete"
Write-Host ""

# Phase 4: Error traffic (generates non-zero error rate for colour coding)
Log "Phase 4: Generating error traffic (for service map colours) ..."
Send-Error -Message "Simulated timeout for demo" -Session $SessionC
Start-Sleep -Seconds 2
Send-Error -Message "Simulated validation failure" -Session $SessionA
Start-Sleep -Seconds 2
Send-Error -Message "Simulated upstream error" -Session $SessionB
Ok "Phase 4 complete -- errors recorded"
Write-Host ""

# Phase 5: Cool-down (more successful requests to settle error rate)
Log "Phase 5: Cool-down -- sending successful requests ..."
Send-Chat -Session $SessionA -Message "Summarise the key points of the leave policy"
Start-Sleep -Seconds 5
Send-Chat -Session $SessionB -Message "What are the main data protection principles?"
Start-Sleep -Seconds 5
Send-Chat -Session $SessionC -Message "How do I submit an expense claim?"
Ok "Phase 5 complete"
Write-Host ""

Write-Host "==============================================" -ForegroundColor White
Write-Host "  Simulation complete!" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor White
Write-Host ""
Log "Open Splunk Observability Cloud and set the time picker to"
Log "'Last 15 minutes' to see the generated data."
Log ""
Log "Session IDs for trace filtering:"
Log "  Alice: $SessionA"
Log "  Bob:   $SessionB"
Log "  Carol: $SessionC"
Write-Host ""
