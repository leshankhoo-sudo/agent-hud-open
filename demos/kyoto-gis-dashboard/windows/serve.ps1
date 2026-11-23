# Kyoto Prefecture Travel Atlas - local web server for Windows (no install needed).
# Serves the "site" folder at http://localhost:8765/ using Windows PowerShell 5.1+.
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'site'))
if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Host "The 'site' folder was not found next to this script. Unzip the whole ZIP first, then run Start-Dashboard.bat again."
  Read-Host 'Press Enter to close'
  exit 1
}
$listener = $null
$port = 0
foreach ($p in 8765..8775) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $port = $p; break } catch { $l.Close() }
}
if ($null -eq $listener) {
  Write-Host 'Could not open a local port between 8765 and 8775.'
  Read-Host 'Press Enter to close'
  exit 1
}
$url = "http://localhost:$port/"
Write-Host ''
Write-Host '  Kyoto Prefecture Travel Atlas is running.'
Write-Host "  Address: $url"
Write-Host '  Keep this window open while you use the dashboard.'
Write-Host '  Close this window to stop it.'
Write-Host ''
Start-Process $url
# The assistant's relay, with the same rules as server/assistantRelay.js for the dev server. The page posts
# the conversation to /api/assistant on this computer; this script adds the Gemini API key from this
# computer's environment (GEMINI_API_KEY, set once with setx) and passes it on to Google. The key never
# reaches the browser and is not in any file of the site.
# assistant-config.json next to this script sets the model (gemini-4-hydrogen; GEMINI_MODEL overrides it),
# the allowed thinking levels (medium by default, high for planning), the Standard service tier (never
# Priority), the prices for the cost estimate, the billing currency (RM) and the limits: requests and cost
# per day, output tokens, timeout, retries and the duplicate guard. Each call is logged to
# assistant-usage.jsonl here: token counts and the estimated cost only (no question, answer or key). GEMINI_API_BASE is only for tests.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
$AssistantLog = Join-Path $PSScriptRoot 'assistant-usage.jsonl'
$Inv = [Globalization.CultureInfo]::InvariantCulture
$script:LastRequest = @{ Hash = ''; At = [datetime]::MinValue }
function Get-UserSetting($name) {
  $v = [Environment]::GetEnvironmentVariable($name, 'Process')
  if (-not $v) { $v = [Environment]::GetEnvironmentVariable($name, 'User') }
  return $v
}
function Send-Json($res, $code, $text) {
  $res.StatusCode = $code
  $res.ContentType = 'application/json; charset=utf-8'
  $b = [System.Text.Encoding]::UTF8.GetBytes($text)
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
}
function Get-JsonText($s) {
  if ($null -eq $s) { return 'null' }
  $t = ([string]$s).Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
  return '"' + ($t -replace '[\x00-\x1f]', ' ') + '"'
}
function Get-Num($x) { return ([double]$x).ToString($Inv) }
function Send-Error($res, $code, $message) { Send-Json $res $code ('{"error":{"message":' + (Get-JsonText $message) + '}}') }
function Get-AssistantConfig {
  $c = @{ model = 'gemini-4-hydrogen'; tDefault = 'medium'; tPlanning = 'high'; allowed = @('medium', 'high'); tier = 'standard'
    pIn = 1.5; pCached = 0.075; pOut = 7.5; curCode = 'USD'; curSymbol = '$'; perUsd = 1.0
    max_requests_per_day = 200; max_cost_per_day = 1.0; max_tool_rounds_per_question = 6; max_tool_calls_per_question = 12
    max_history_turns = 6; max_output_tokens = 8192; timeout_seconds = 90; retries = 2; duplicate_window_seconds = 5 }
  $f = Join-Path $PSScriptRoot 'assistant-config.json'
  if (Test-Path -LiteralPath $f) {
    try {
      $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json
      if ($j.model) { $c.model = [string]$j.model }
      if ($j.thinking.default) { $c.tDefault = ([string]$j.thinking.default).ToLower() }
      if ($j.thinking.planning) { $c.tPlanning = ([string]$j.thinking.planning).ToLower() }
      if ($j.thinking.allowed) { $c.allowed = @($j.thinking.allowed | ForEach-Object { ([string]$_).ToLower() }) }
      if ($j.service_tier) { $c.tier = ([string]$j.service_tier).ToLower() }
      $pr = $j.price_usd_per_million_tokens
      if ($pr) {
        if ($null -ne $pr.input) { $c.pIn = [double]$pr.input }
        if ($null -ne $pr.cached_input) { $c.pCached = [double]$pr.cached_input }
        if ($null -ne $pr.output_including_thinking) { $c.pOut = [double]$pr.output_including_thinking }
      }
      $bc = $j.billing_currency
      if ($bc) {
        if ($bc.code) { $c.curCode = [string]$bc.code }
        if ($bc.symbol) { $c.curSymbol = [string]$bc.symbol }
        if ($null -ne $bc.per_usd) { $c.perUsd = [double]$bc.per_usd }
      }
      if ($j.limits) { foreach ($k in @('max_requests_per_day', 'max_cost_per_day', 'max_tool_rounds_per_question', 'max_tool_calls_per_question', 'max_history_turns', 'max_output_tokens', 'timeout_seconds', 'retries', 'duplicate_window_seconds')) { if ($null -ne $j.limits.$k) { $c[$k] = [double]$j.limits.$k } } }
    } catch { }
  }
  $m = Get-UserSetting 'GEMINI_MODEL'
  if ($m) { $c.model = $m }
  return $c
}
# today's calls and estimated cost, from the usage log
function Get-AssistantToday($day, $perUsd) {
  $n = 0; $usd = 0.0
  if (Test-Path -LiteralPath $AssistantLog) {
    foreach ($line in [IO.File]::ReadAllLines($AssistantLog)) {
      if (-not $line.Contains('"day":"' + $day + '"')) { continue }
      $n++
      $mm = [regex]::Match($line, '"usd":([0-9.eE+-]+)')
      if ($mm.Success) { $usd += [double]::Parse($mm.Groups[1].Value, $Inv) }
    }
  }
  return @{ requests = $n; usd = [math]::Round($usd, 6); cost = [math]::Round($usd * $perUsd, 6) }
}
function Get-TodayJson($t) { return '{"requests":' + $t.requests + ',"usd":' + (Get-Num $t.usd) + ',"cost":' + (Get-Num $t.cost) + '}' }
function Invoke-AssistantRelay($ctx) {
  $res = $ctx.Response
  $c = Get-AssistantConfig
  $key = Get-UserSetting 'GEMINI_API_KEY'
  $now = Get-Date
  $day = $now.ToString('yyyy-MM-dd', $Inv)
  if ($ctx.Request.Url.AbsolutePath.EndsWith('/status')) {
    $conf = 'false'; if ($key) { $conf = 'true' }
    $allowed = ($c.allowed | ForEach-Object { Get-JsonText $_ }) -join ','
    $lim = (@('max_requests_per_day', 'max_cost_per_day', 'max_tool_rounds_per_question', 'max_tool_calls_per_question', 'max_history_turns', 'max_output_tokens', 'timeout_seconds', 'retries', 'duplicate_window_seconds') | ForEach-Object { '"' + $_ + '":' + (Get-Num $c[$_]) }) -join ','
    $st = '{"configured":' + $conf + ',"model":' + (Get-JsonText $c.model) + ',"thinking":{"default":' + (Get-JsonText $c.tDefault) + ',"planning":' + (Get-JsonText $c.tPlanning) + ',"allowed":[' + $allowed + ']}' +
      ',"service_tier":' + (Get-JsonText $c.tier) + ',"limits":{' + $lim + '},"price_usd_per_million_tokens":{"input":' + (Get-Num $c.pIn) + ',"cached_input":' + (Get-Num $c.pCached) + ',"output_including_thinking":' + (Get-Num $c.pOut) + '}' +
      ',"billing_currency":{"code":' + (Get-JsonText $c.curCode) + ',"symbol":' + (Get-JsonText $c.curSymbol) + ',"per_usd":' + (Get-Num $c.perUsd) + '}' +
      ',"today":' + (Get-TodayJson (Get-AssistantToday $day $c.perUsd)) + '}'
    Send-Json $res 200 $st; return
  }
  if ($ctx.Request.HttpMethod -ne 'POST') { Send-Error $res 405 'Use POST.'; return }
  $ms = New-Object System.IO.MemoryStream
  $ctx.Request.InputStream.CopyTo($ms)
  if ($ms.Length -gt 2MB) { Send-Error $res 413 'The conversation is too long.'; return }
  if (-not $key) { Send-Error $res 503 'GEMINI_API_KEY is not set on this computer. See Support for how to add it.'; return }
  $rawBytes = $ms.ToArray()
  $text = [System.Text.Encoding]::UTF8.GetString($rawBytes)
  try { $req = $text | ConvertFrom-Json } catch { Send-Error $res 400 'The request is not JSON.'; return }
  if ($null -eq $req.contents -or @($req.contents).Count -eq 0) { Send-Error $res 400 'The request has no conversation.'; return }
  # the rules: Standard tier only, an allowed thinking level, an output cap within the limit
  foreach ($tierIn in @($req.serviceTier, $req.service_tier)) { if ($null -ne $tierIn -and ([string]$tierIn).ToLower() -ne $c.tier) { Send-Error $res 400 ('Only the ' + $c.tier + ' service tier is allowed here (not ' + $tierIn + ').'); return } }
  $inject = ''
  if ($null -eq $req.serviceTier -and $null -eq $req.service_tier) { $inject += '"serviceTier":' + (Get-JsonText $c.tier) + ',' }
  $g = $req.generationConfig
  if ($null -eq $g) {
    $level = $c.tDefault
    $inject += '"generationConfig":{"thinkingConfig":{"thinkingLevel":' + (Get-JsonText $level) + '},"maxOutputTokens":' + (Get-Num $c.max_output_tokens) + '},'
  } else {
    $level = ([string]$g.thinkingConfig.thinkingLevel).ToLower()
    if (-not $level) { Send-Error $res 400 'The request has no thinking level.'; return }
    if ($c.allowed -notcontains $level) { Send-Error $res 400 ('Thinking level ' + $level + ' is not allowed (allowed: ' + ($c.allowed -join ', ') + ').'); return }
    if (-not ([double]$g.maxOutputTokens -gt 0)) { Send-Error $res 400 'The request has no output token limit.'; return }
    if ([double]$g.maxOutputTokens -gt $c.max_output_tokens) { Send-Error $res 400 ('The output limit is ' + (Get-Num $c.max_output_tokens) + ' tokens.'); return }
  }
  if ($inject) { $t0 = $text.TrimStart(); $text = '{' + $inject + $t0.Substring(1) }
  # the same request twice in a few seconds (a double click, a loop) is not sent again
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = [BitConverter]::ToString($sha.ComputeHash($rawBytes))
  if ($script:LastRequest.Hash -eq $hash -and ($now - $script:LastRequest.At).TotalSeconds -lt $c.duplicate_window_seconds) { Send-Error $res 409 ('The same request arrived twice within ' + (Get-Num $c.duplicate_window_seconds) + ' s; the second one was not sent to Gemini.'); return }
  $today = Get-AssistantToday $day $c.perUsd
  if ($today.requests -ge $c.max_requests_per_day) { Send-Error $res 429 ('Daily limit reached: ' + $today.requests + ' Gemini requests today (max_requests_per_day in assistant-config.json).'); return }
  if ($today.cost -ge $c.max_cost_per_day) { Send-Error $res 429 ('Daily limit reached: about ' + $c.curSymbol + $today.cost.ToString('0.0000', $Inv) + ' (US$' + $today.usd.ToString('0.0000', $Inv) + ') spent today; max_cost_per_day is ' + $c.curSymbol + (Get-Num $c.max_cost_per_day) + ' in assistant-config.json.'); return }
  $script:LastRequest = @{ Hash = $hash; At = $now }
  $base = Get-UserSetting 'GEMINI_API_BASE'
  if (-not $base) { $base = 'https://generativelanguage.googleapis.com' }
  $url = $base.TrimEnd('/') + '/v1beta/models/' + [Uri]::EscapeDataString($c.model) + ':generateContent'
  $body = [System.Text.Encoding]::UTF8.GetBytes($text)
  $attempts = 0; $status = 0; $respText = ''; $tierHdr = $null; $errMsg = $null; $timedOut = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    $attempts++; $status = 0; $errMsg = $null; $retryAfter = 0
    try {
      $wr = [System.Net.HttpWebRequest]::Create($url)
      $wr.Method = 'POST'
      $wr.ContentType = 'application/json'
      $wr.Headers.Add('x-goog-api-key', $key)
      $wr.Timeout = [int]($c.timeout_seconds * 1000)
      $wr.ReadWriteTimeout = [int]($c.timeout_seconds * 1000)
      $wr.ContentLength = $body.Length
      $rs = $wr.GetRequestStream(); $rs.Write($body, 0, $body.Length); $rs.Close()
      try { $resp = $wr.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response; if (-not $resp) { throw } }
      $status = [int]$resp.StatusCode
      $tierHdr = $resp.Headers['x-gemini-service-tier']
      $ra = $resp.Headers['Retry-After']; if ($ra) { [void][int]::TryParse($ra, [ref]$retryAfter) }
      $out = New-Object System.IO.MemoryStream
      $resp.GetResponseStream().CopyTo($out)
      $resp.Close()
      $respText = [System.Text.Encoding]::UTF8.GetString($out.ToArray())
    } catch {
      $e = $_.Exception
      if ($e.InnerException -is [System.Net.WebException]) { $e = $e.InnerException }
      $timedOut = ($e -is [System.Net.WebException]) -and ($e.Status -eq [System.Net.WebExceptionStatus]::Timeout)
      $errMsg = $e.Message
    }
    $retry = ($status -eq 0) -or (@(429, 500, 502, 503, 504) -contains $status)
    if (-not $retry -or $attempts -gt $c.retries) { break }
    if ($retryAfter -gt 0) { Start-Sleep -Seconds ([Math]::Min($retryAfter, 10)) } else { Start-Sleep -Milliseconds (1500 * $attempts) }
  }
  $elapsed = $sw.ElapsedMilliseconds
  # token counts and the estimated cost (thinking tokens are billed as output)
  $pt = 0.0; $ct = 0.0; $tt = 0.0; $ot = 0.0; $th = 0.0; $tot = 0.0; $mv = $null; $gErr = $null
  if ($respText) {
    try {
      $j = $respText | ConvertFrom-Json
      $um = $j.usageMetadata
      if ($um) { $pt = [double]$um.promptTokenCount; $ct = [double]$um.cachedContentTokenCount; $tt = [double]$um.toolUsePromptTokenCount; $ot = [double]$um.candidatesTokenCount; $th = [double]$um.thoughtsTokenCount; $tot = [double]$um.totalTokenCount }
      $mv = $j.modelVersion
      if ($j.error) { $gErr = [string]$j.error.message }
    } catch { }
  }
  if ($tot -eq 0) { $tot = $pt + $tt + $ot + $th }
  $usd = [math]::Round((($pt - $ct + $tt) * $c.pIn + $ct * $c.pCached + ($ot + $th) * $c.pOut) / 1e6, 6)
  if ($status -eq 0) { if ($timedOut) { $errMsg = 'Gemini did not answer within ' + (Get-Num $c.timeout_seconds) + ' s.' } }
  elseif ($status -ge 400) { $errMsg = $gErr; if (-not $errMsg) { $errMsg = 'HTTP ' + $status } }
  if ($errMsg) { $errMsg = $errMsg.Replace($key, '[key]') }
  if (-not $tierHdr) { $tierHdr = $c.tier }
  $entry = '{"time":' + (Get-JsonText ([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', $Inv))) + ',"day":' + (Get-JsonText $day) + ',"model":' + (Get-JsonText $c.model) +
    ',"model_version":' + (Get-JsonText $mv) + ',"thinking":' + (Get-JsonText $level) + ',"tier":' + (Get-JsonText $tierHdr) + ',"status":' + $status + ',"attempts":' + $attempts + ',"ms":' + $elapsed +
    ',"input":' + (Get-Num ($pt + $tt)) + ',"cached":' + (Get-Num $ct) + ',"output":' + (Get-Num $ot) + ',"thinking_tokens":' + (Get-Num $th) + ',"total":' + (Get-Num $tot) + ',"usd":' + (Get-Num $usd) + ',"currency":' + (Get-JsonText $c.curCode) + ',"cost":' + (Get-Num ([math]::Round($usd * $c.perUsd, 6))) + ',"error":' + (Get-JsonText $errMsg) + '}'
  try { [IO.File]::AppendAllText($AssistantLog, $entry + "`n", (New-Object System.Text.UTF8Encoding($false))) } catch { }
  if ($status -eq 0) {
    if ($timedOut) { Send-Error $res 504 ($errMsg + ' Tried ' + $attempts + ' times.') } else { Send-Error $res 502 ('Could not reach the Gemini API (' + $errMsg + '). Tried ' + $attempts + ' times.') }
    return
  }
  $usage = $entry.Substring(0, $entry.Length - 1) + ',"today":' + (Get-TodayJson (Get-AssistantToday $day $c.perUsd)) + '}'
  $tr = $respText.TrimStart()
  if ($tr.StartsWith('{')) {
    $rest = $tr.Substring(1).TrimStart()
    if ($rest.StartsWith('}')) { $respText = '{"atlasUsage":' + $usage + '}' } else { $respText = '{"atlasUsage":' + $usage + ',' + $tr.Substring(1) }
  }
  Send-Json $res $status $respText
}
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.geojson' = 'application/geo+json; charset=utf-8'; '.csv' = 'text/csv; charset=utf-8'
  '.woff2' = 'font/woff2'; '.woff' = 'font/woff'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
  '.webp' = 'image/webp'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.mp4' = 'video/mp4'; '.webm' = 'video/webm'; '.mp3' = 'audio/mpeg'
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq 'api/assistant' -or $rel -eq 'api/assistant/status') { Invoke-AssistantRelay $ctx; continue }
    if ($rel -eq '') { $rel = 'index.html' }
    $path = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    if ((-not $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) -or (-not (Test-Path -LiteralPath $path -PathType Leaf))) {
      $res.StatusCode = 404
      $b = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $res.OutputStream.Write($b, 0, $b.Length)
    } else {
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    $res.OutputStream.Close()
  }
}
