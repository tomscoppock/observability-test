# run-eval.ps1 -- Run golden Q&A evaluation against the live RAG API.
#
# Sends each question from sample-docs/golden-qa.json to the chat API,
# checks that the response contains the expected source document and
# required key phrases, and prints a pass/fail summary.
#
# Usage:
#   .\scripts\run-eval.ps1 [-BaseUrl http://localhost]

param(
    [string]$BaseUrl = 'http://localhost'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$GoldenQA = Join-Path $ProjectRoot 'sample-docs' 'golden-qa.json'

# ---------------------------------------------------------------------------
# Validate prerequisites
# ---------------------------------------------------------------------------
if (-not (Test-Path $GoldenQA)) {
    Write-Error "Golden Q&A dataset not found at $GoldenQA"
    exit 1
}

# Check API health
try {
    $health = Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 5
    if ($health.StatusCode -ne 200) {
        Write-Error "API returned HTTP $($health.StatusCode). Is the stack running?"
        exit 1
    }
} catch {
    Write-Error "API is not reachable at $BaseUrl. Start with: docker compose up -d"
    exit 1
}

# ---------------------------------------------------------------------------
# Load dataset
# ---------------------------------------------------------------------------
$dataset = Get-Content $GoldenQA -Raw | ConvertFrom-Json
$entries = $dataset.entries
$entryCount = $entries.Count

$pass = 0
$fail = 0
$errors = 0

Write-Host '=== RAG Evaluation ===' -ForegroundColor Cyan
Write-Host "Dataset:    $GoldenQA"
Write-Host "API:        $BaseUrl"
Write-Host "Questions:  $entryCount"
Write-Host ''

# ---------------------------------------------------------------------------
# Run evaluation
# ---------------------------------------------------------------------------
foreach ($entry in $entries) {
    $question = $entry.question
    $expectedSource = $entry.expectedSource
    $description = $entry.description
    $entryId = $entry.id
    $requiredPhrases = @($entry.requiredPhrases)

    Write-Host "[$entryId/$entryCount] $description" -ForegroundColor Cyan
    Write-Host "  Q: $question"

    # Call the chat API
    try {
        $body = @{ message = $question } | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Uri "$BaseUrl/api/chat" `
            -Method POST `
            -ContentType 'application/json' `
            -Body $body `
            -TimeoutSec 30
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $errors++
        Write-Host ''
        continue
    }

    if ($response.error) {
        Write-Host "  ERROR: $($response.error)" -ForegroundColor Red
        $errors++
        Write-Host ''
        continue
    }

    $reply = $response.reply
    $replyLower = $reply.ToLower()
    $replyLength = $reply.Length

    # Check source document
    $sourceMatch = $false
    $expectedLower = ($expectedSource -replace '\.txt$', '' -replace '-', ' ').ToLower()

    if ($response.sources) {
        foreach ($src in $response.sources) {
            if ($src.title -and $src.title.ToLower().Contains($expectedLower)) {
                $sourceMatch = $true
                break
            }
        }
    }

    # Also check if the reply mentions the expected source
    if (-not $sourceMatch -and $replyLower.Contains($expectedLower)) {
        $sourceMatch = $true
    }

    # Check required phrases
    $phrasePass = 0
    $phraseFailList = @()
    foreach ($phrase in $requiredPhrases) {
        if ($replyLower.Contains($phrase.ToLower())) {
            $phrasePass++
        } else {
            $phraseFailList += "'$phrase'"
        }
    }

    # Determine pass/fail
    $allPass = $true
    if (-not $sourceMatch) {
        $allPass = $false
        Write-Host "  FAIL: Expected source '$expectedSource' not found in response" -ForegroundColor Red
    }
    if ($phraseFailList.Count -gt 0) {
        $allPass = $false
        Write-Host "  FAIL: Missing phrases: $($phraseFailList -join ', ')" -ForegroundColor Red
    }

    if ($allPass) {
        Write-Host "  PASS (source: ok, phrases: $phrasePass/$($requiredPhrases.Count), length: $replyLength chars)" -ForegroundColor Green
        $pass++
    } else {
        Write-Host "  Phrases matched: $phrasePass/$($requiredPhrases.Count), length: $replyLength chars" -ForegroundColor Yellow
        $fail++
    }
    Write-Host ''
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$total = $pass + $fail + $errors

Write-Host '=== Evaluation Summary ===' -ForegroundColor Cyan
Write-Host "  Total:   $total"
Write-Host "  Pass:    $pass" -ForegroundColor Green
if ($fail -gt 0) {
    Write-Host "  Fail:    $fail" -ForegroundColor Red
} else {
    Write-Host "  Fail:    $fail"
}
if ($errors -gt 0) {
    Write-Host "  Errors:  $errors" -ForegroundColor Red
} else {
    Write-Host "  Errors:  $errors"
}
Write-Host ''

$score = 0
if ($total -gt 0) { $score = [math]::Floor(($pass * 100) / $total) }
Write-Host "  Score:   ${score}%"

if ($fail -gt 0 -or $errors -gt 0) { exit 1 }
