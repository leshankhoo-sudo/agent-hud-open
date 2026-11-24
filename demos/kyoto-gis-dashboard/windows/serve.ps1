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
# the models the person can choose in the page (X-Atlas-Preferred) and the fallback models used in order when
# the chosen one is overloaded, rate-limited or failing (unless the page sends X-Atlas-Fallback: off; a model
# that fails is skipped for a few minutes), at most 3 retries with exponential backoff (1 s, 2 s, 4 s),
# the allowed thinking levels (medium by default, high for planning), the service tier (Standard by default;
# Priority only when the page sends X-Atlas-Priority-Confirmed: yes after the person accepted its prices),
# the prices for the cost estimate, the billing currency (RM) and the limits: requests and cost
# per day, output tokens, timeout, retries and the duplicate guard. Each call is logged to
# assistant-usage.jsonl here: token counts and the estimated cost only (no question, answer or key). GEMINI_API_BASE is only for tests.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
$AssistantLog = Join-Path $PSScriptRoot 'assistant-usage.jsonl'
$Inv = [Globalization.CultureInfo]::InvariantCulture
$script:LastRequest = @{ Hash = ''; At = [datetime]::MinValue }
$script:Cooling = @{}   # model -> until when it is skipped
# Gemini's thought signatures only work with the model that wrote them; when a conversation moves to another
# model they are replaced by the placeholder Google documents for conversations from another model
$SignaturePlaceholder = 'skip_thought_signature_validator'
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
function Send-Error($res, $code, $message, $kind) {
  $k = ''; if ($kind) { $k = ',"kind":' + (Get-JsonText $kind) }
  Send-Json $res $code ('{"error":{"message":' + (Get-JsonText $message) + $k + '}}')
}
# what went wrong, from the status of an attempt
function Get-ErrorKind($status, $timedOut) {
  if ($status -eq 0) { if ($timedOut) { return 'timeout' } else { return 'network' } }
  if ($status -lt 300) { return 'ok' }
  if ($status -eq 402) { return 'billing' }
  if ($status -eq 429) { return 'rate_limit' }
  if ($status -eq 503) { return 'overloaded' }
  if ($status -eq 400) { return 'bad_request' }
  if ($status -eq 401 -or $status -eq 403) { return 'auth' }
  if ($status -eq 404) { return 'not_found' }
  if ($status -ge 500) { return 'server' }
  return 'error'
}
function Get-FailMessage($kind, $status, $google, $tried, $c) {
  $why = 'Gemini answered HTTP ' + $status + '.'
  if ($kind -eq 'billing') { $why = 'Billing: the Google project has no prepaid credit left (HTTP 402). Add credit in AI Studio > Billing.' }
  elseif ($kind -eq 'rate_limit') { $why = 'Rate limit or quota reached (HTTP 429). Wait a minute and ask again.' }
  elseif ($kind -eq 'overloaded') { $why = 'Gemini is overloaded right now (HTTP 503). This is on Google''s side; try again in a few minutes.' }
  elseif ($kind -eq 'server') { $why = 'The Gemini service had an error (HTTP ' + $status + '). Try again in a few minutes.' }
  elseif ($kind -eq 'timeout') { $why = 'Gemini did not answer within ' + (Get-Num $c.timeout_seconds) + ' s.' }
  elseif ($kind -eq 'network') { $why = 'This computer could not reach the Gemini API (network error). Check the internet connection or a firewall.' }
  elseif ($kind -eq 'auth') { $why = 'Google refused the API key (HTTP ' + $status + '). Check GEMINI_API_KEY on this computer.' }
  elseif ($kind -eq 'not_found') { $why = 'The model was not found (HTTP 404). Check the model names in assistant-config.json.' }
  elseif ($kind -eq 'bad_request') { $why = 'Gemini could not read the request (HTTP 400).' }
  $m = $why + ' Models tried: ' + $tried + '.'
  if ($google) { $m += ' Google said: ' + $google }
  return $m
}
function Get-AssistantConfig {
  $c = @{ model = 'gemini-4-hydrogen'; fallbacks = @(); selectable = @(); tDefault = 'medium'; tPlanning = 'high'; allowed = @('medium', 'high'); tier = 'standard'; tiers = @('standard')
    prices = @{ 'gemini-4-hydrogen' = @(1.5, 0.075, 7.5) }; pricesPriority = @{}; curCode = 'USD'; curSymbol = '$'; perUsd = 1.0
    max_requests_per_day = 200; max_cost_per_day = 1.0; max_tool_rounds_per_question = 6; max_tool_calls_per_question = 12
    max_history_turns = 6; max_output_tokens = 8192; timeout_seconds = 45; retries = 3; backoff_seconds = 1; max_total_seconds = 100
    cooldown_seconds = 180; duplicate_window_seconds = 5 }
  $f = Join-Path $PSScriptRoot 'assistant-config.json'
  if (Test-Path -LiteralPath $f) {
    try {
      $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json
      if ($j.model) { $c.model = [string]$j.model }
      if ($j.fallback_models) { $c.fallbacks = @($j.fallback_models | ForEach-Object { [string]$_ }) }
      if ($j.thinking.default) { $c.tDefault = ([string]$j.thinking.default).ToLower() }
      if ($j.thinking.planning) { $c.tPlanning = ([string]$j.thinking.planning).ToLower() }
      if ($j.thinking.allowed) { $c.allowed = @($j.thinking.allowed | ForEach-Object { ([string]$_).ToLower() }) }
      if ($j.service_tier) { $c.tier = ([string]$j.service_tier).ToLower() }
      if ($j.service_tiers) { $c.tiers = @($j.service_tiers | ForEach-Object { ([string]$_).ToLower() }) }
      if ($j.selectable_models) { $c.selectable = @($j.selectable_models | ForEach-Object { [string]$_ }) }
      $pr = $j.price_usd_per_million_tokens
      if ($pr) { foreach ($p in $pr.PSObject.Properties) { if ($null -ne $p.Value.input) { $c.prices[$p.Name] = @([double]$p.Value.input, [double]$p.Value.cached_input, [double]$p.Value.output_including_thinking) } } }
      $pp = $j.price_usd_per_million_tokens_priority
      if ($pp) { foreach ($p in $pp.PSObject.Properties) { if ($null -ne $p.Value.input) { $c.pricesPriority[$p.Name] = @([double]$p.Value.input, [double]$p.Value.cached_input, [double]$p.Value.output_including_thinking) } } }
      $bc = $j.billing_currency
      if ($bc) {
        if ($bc.code) { $c.curCode = [string]$bc.code }
        if ($bc.symbol) { $c.curSymbol = [string]$bc.symbol }
        if ($null -ne $bc.per_usd) { $c.perUsd = [double]$bc.per_usd }
      }
      if ($j.limits) { foreach ($k in @('max_requests_per_day', 'max_cost_per_day', 'max_tool_rounds_per_question', 'max_tool_calls_per_question', 'max_history_turns', 'max_output_tokens', 'timeout_seconds', 'retries', 'backoff_seconds', 'max_total_seconds', 'cooldown_seconds', 'duplicate_window_seconds')) { if ($null -ne $j.limits.$k) { $c[$k] = [double]$j.limits.$k } } }
    } catch { }
  }
  $m = Get-UserSetting 'GEMINI_MODEL'
  if ($m) { $c.model = $m }
  $c.fallbacks = @($c.fallbacks | Where-Object { $_ -and $_ -ne $c.model })
  $sel = @($c.model); foreach ($m in $c.selectable) { if ($m -and $sel -notcontains $m) { $sel += $m } }; $c.selectable = $sel
  $ts = @($c.tier); foreach ($t in $c.tiers) { if ($t -and $ts -notcontains $t) { $ts += $t } }; $c.tiers = $ts
  return $c
}
function Get-Price($c, $model, $tier) {
  if ($tier -eq 'priority' -and $c.pricesPriority.ContainsKey($model)) { return $c.pricesPriority[$model] }
  if ($c.prices.ContainsKey($model)) { return $c.prices[$model] }
  if ($c.prices.ContainsKey($c.model)) { return $c.prices[$c.model] }
  return @(1.5, 0.075, 7.5)
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
    $lim = (@('max_requests_per_day', 'max_cost_per_day', 'max_tool_rounds_per_question', 'max_tool_calls_per_question', 'max_history_turns', 'max_output_tokens', 'timeout_seconds', 'retries', 'backoff_seconds', 'max_total_seconds', 'cooldown_seconds', 'duplicate_window_seconds') | ForEach-Object { '"' + $_ + '":' + (Get-Num $c[$_]) }) -join ','
    $st = '{"configured":' + $conf + ',"model":' + (Get-JsonText $c.model) + ',"thinking":{"default":' + (Get-JsonText $c.tDefault) + ',"planning":' + (Get-JsonText $c.tPlanning) + ',"allowed":[' + $allowed + ']}' +
      ',"service_tier":' + (Get-JsonText $c.tier) + ',"limits":{' + $lim + '},"price_usd_per_million_tokens":{' + (($c.prices.Keys | Sort-Object | ForEach-Object { (Get-JsonText $_) + ':{"input":' + (Get-Num $c.prices[$_][0]) + ',"cached_input":' + (Get-Num $c.prices[$_][1]) + ',"output_including_thinking":' + (Get-Num $c.prices[$_][2]) + '}' }) -join ',') + '}' +
      ',"fallback_models":[' + (($c.fallbacks | ForEach-Object { Get-JsonText $_ }) -join ',') + ']' +
      ',"selectable_models":[' + (($c.selectable | ForEach-Object { Get-JsonText $_ }) -join ',') + ']' +
      ',"service_tiers":[' + (($c.tiers | ForEach-Object { Get-JsonText $_ }) -join ',') + ']' +
      ',"price_usd_per_million_tokens_priority":{' + (($c.pricesPriority.Keys | Sort-Object | ForEach-Object { (Get-JsonText $_) + ':{"input":' + (Get-Num $c.pricesPriority[$_][0]) + ',"cached_input":' + (Get-Num $c.pricesPriority[$_][1]) + ',"output_including_thinking":' + (Get-Num $c.pricesPriority[$_][2]) + '}' }) -join ',') + '}' +
      ',"cooling":{' + (($script:Cooling.Keys | Where-Object { $script:Cooling[$_] -gt $now } | ForEach-Object { (Get-JsonText $_) + ':' + [int](($script:Cooling[$_] - $now).TotalSeconds) }) -join ',') + '}' +
      ',"billing_currency":{"code":' + (Get-JsonText $c.curCode) + ',"symbol":' + (Get-JsonText $c.curSymbol) + ',"per_usd":' + (Get-Num $c.perUsd) + '}' +
      ',"today":' + (Get-TodayJson (Get-AssistantToday $day $c.perUsd)) + '}'
    Send-Json $res 200 $st; return
  }
  if ($ctx.Request.HttpMethod -ne 'POST') { Send-Error $res 405 'Use POST.'; return }
  $ms = New-Object System.IO.MemoryStream
  $ctx.Request.InputStream.CopyTo($ms)
  if ($ms.Length -gt 2MB) { Send-Error $res 413 'The conversation is too long.'; return }
  if (-not $key) { Send-Error $res 503 'GEMINI_API_KEY is not set on this computer. See Support for how to add it.' 'no_key'; return }
  $rawBytes = $ms.ToArray()
  $text = [System.Text.Encoding]::UTF8.GetString($rawBytes)
  try { $req = $text | ConvertFrom-Json } catch { Send-Error $res 400 'The request is not JSON.'; return }
  if ($null -eq $req.contents -or @($req.contents).Count -eq 0) { Send-Error $res 400 'The request has no conversation.'; return }
  # the rules: an allowed service tier (Priority only after the person confirmed its price), an allowed
  # thinking level, an output cap within the limit
  $asked = @(@($req.serviceTier, $req.service_tier) | Where-Object { $null -ne $_ } | ForEach-Object { ([string]$_).ToLower() } | Select-Object -Unique)
  if ($asked.Count -gt 1) { Send-Error $res 400 'The request names two different service tiers.'; return }
  $reqTier = $c.tier; if ($asked.Count -eq 1) { $reqTier = $asked[0] }
  if ($c.tiers -notcontains $reqTier) { Send-Error $res 400 ('The ' + $reqTier + ' service tier is not allowed here (allowed: ' + ($c.tiers -join ', ') + ').'); return }
  if ($reqTier -eq 'priority' -and ([string]$ctx.Request.Headers['X-Atlas-Priority-Confirmed']).ToLower() -ne 'yes') { Send-Error $res 400 'Priority costs more than Standard: it is used only after you confirm its price in the assistant.' 'priority_unconfirmed'; return }
  $inject = ''
  if ($null -eq $req.serviceTier -and $null -eq $req.service_tier) { $inject += '"serviceTier":' + (Get-JsonText $c.tier) + ',' }
  elseif ($null -ne $req.service_tier -and $null -eq $req.serviceTier) { $inject += '"serviceTier":' + (Get-JsonText $reqTier) + ',' }
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
  # Google takes serviceTier; a service_tier from the page is passed on under that name only
  if ($null -ne $req.service_tier) { $text = [regex]::Replace([regex]::Replace($text, ',\s*"service_tier"\s*:\s*"[^"]*"', ''), '"service_tier"\s*:\s*"[^"]*"\s*,?', '') }
  if ($inject) { $t0 = $text.TrimStart(); $text = '{' + $inject + $t0.Substring(1) }
  # the same request twice in a few seconds (a double click, a loop) is not sent again
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = [BitConverter]::ToString($sha.ComputeHash($rawBytes))
  if ($script:LastRequest.Hash -eq $hash -and ($now - $script:LastRequest.At).TotalSeconds -lt $c.duplicate_window_seconds) { Send-Error $res 409 ('The same request arrived twice within ' + (Get-Num $c.duplicate_window_seconds) + ' s; the second one was not sent to Gemini.') 'duplicate'; return }
  $today = Get-AssistantToday $day $c.perUsd
  if ($today.requests -ge $c.max_requests_per_day) { Send-Error $res 429 ('Daily limit reached: ' + $today.requests + ' Gemini requests today (max_requests_per_day in assistant-config.json).') 'daily_limit'; return }
  if ($today.cost -ge $c.max_cost_per_day) { Send-Error $res 429 ('Daily limit reached: about ' + $c.curSymbol + $today.cost.ToString('0.0000', $Inv) + ' (US$' + $today.usd.ToString('0.0000', $Inv) + ') spent today; max_cost_per_day is ' + $c.curSymbol + (Get-Num $c.max_cost_per_day) + ' in assistant-config.json.') 'daily_limit'; return }
  $script:LastRequest = @{ Hash = $hash; At = $now }
  $base = Get-UserSetting 'GEMINI_API_BASE'
  if (-not $base) { $base = 'https://generativelanguage.googleapis.com' }
  # which models to try: the person's choice (else the one this conversation is on), then, with automatic
  # fallback, the others; a model that recently failed is tried after the others (unless every model has)
  $hint = [string]$ctx.Request.Headers['X-Atlas-Model']
  $pref = [string]$ctx.Request.Headers['X-Atlas-Preferred']
  $autoFallback = ([string]$ctx.Request.Headers['X-Atlas-Fallback']).ToLower() -ne 'off'
  $known = @($c.model) + @($c.fallbacks); foreach ($m in $c.selectable) { if ($known -notcontains $m) { $known += $m } }
  $first = $c.model
  if ($pref -and ($known -contains $pref)) { $first = $pref } elseif ($hint -and ($known -contains $hint)) { $first = $hint }
  $order = @($first)
  if ($autoFallback) {
    if ($hint -and ($known -contains $hint) -and $order -notcontains $hint) { $order += $hint }
    foreach ($m in (@($c.model) + @($c.fallbacks))) { if ($order -notcontains $m) { $order += $m } }
  }
  # the models that have not failed lately first, then the ones that have
  $fresh = @($order | Where-Object { -not ($script:Cooling.ContainsKey($_) -and $script:Cooling[$_] -gt $now) })
  $cands = @($fresh) + @($order | Where-Object { $fresh -notcontains $_ })
  $tried = @(); $used = $null; $kind = $null; $google = $null; $billing = $false
  $status = 0; $respText = ''; $tierHdr = $null; $timedOut = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  for ($i = 0; $i -le $c.retries; $i++) {
    $model = $cands[$i % $cands.Count]
    $sendText = $text
    if ($hint -and $model -ne $hint) { $sendText = [regex]::Replace($text, '"thoughtSignature"\s*:\s*"[^"]*"', '"thoughtSignature":"' + $SignaturePlaceholder + '"') }
    $body = [System.Text.Encoding]::UTF8.GetBytes($sendText)
    $url = $base.TrimEnd('/') + '/v1beta/models/' + [Uri]::EscapeDataString($model) + ':generateContent'
    $status = 0; $respText = ''; $errMsg = $null; $retryAfter = 0; $timedOut = $false
    # an attempt never runs past the time left for the whole question
    $left = $c.max_total_seconds * 1000 - $sw.ElapsedMilliseconds
    if ($i -gt 0 -and $left -lt 5000) { break }
    $tmo = [int][Math]::Max(5000, [Math]::Min($c.timeout_seconds * 1000, $left))
    try {
      $wr = [System.Net.HttpWebRequest]::Create($url)
      $wr.Method = 'POST'
      $wr.ContentType = 'application/json'
      $wr.Headers.Add('x-goog-api-key', $key)
      $wr.Timeout = $tmo
      $wr.ReadWriteTimeout = $tmo
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
    $kind = Get-ErrorKind $status $timedOut
    $label = [string]$status; if ($status -eq 0) { $label = $kind }
    $tried += ($model + ' ' + $label)
    if ($kind -eq 'ok') { $used = $model; break }
    if ($kind -eq 'billing') { $billing = $true }
    $google = $errMsg
    if ($respText) { try { $ej = $respText | ConvertFrom-Json; if ($ej.error.message) { $google = [string]$ej.error.message } } catch { } }
    if ($google) { $google = $google.Replace($key, '[key]') }
    if (@('overloaded', 'rate_limit', 'server', 'timeout') -contains $kind) { $script:Cooling[$model] = (Get-Date).AddSeconds($c.cooldown_seconds) }
    if ($kind -eq 'not_found') { $script:Cooling[$model] = (Get-Date).AddDays(1) }
    if (@('overloaded', 'rate_limit', 'server', 'timeout', 'network', 'not_found') -notcontains $kind) { break }
    if ($i -ge $c.retries) { break }
    $wait = 0
    if ($kind -ne 'not_found') { if ($retryAfter -gt 0) { $wait = [Math]::Min($retryAfter, 10) * 1000 } else { $wait = $c.backoff_seconds * 1000 * [Math]::Pow(2, $i) } }
    if ($sw.ElapsedMilliseconds + $wait -gt $c.max_total_seconds * 1000) { break }
    if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]$wait) }
  }
  $elapsed = $sw.ElapsedMilliseconds
  if ($billing -and -not $used) { $kind = 'billing' }
  $model = $used; if (-not $model) { $model = $cands[($tried.Count - 1) % $cands.Count] }
  $triedText = $tried -join ' > '
  # token counts and the estimated cost at that model's prices (thinking tokens are billed as output)
  $pt = 0.0; $ct = 0.0; $tt = 0.0; $ot = 0.0; $th = 0.0; $tot = 0.0; $mv = $null
  if ($used -and $respText) {
    try {
      $j = $respText | ConvertFrom-Json
      $um = $j.usageMetadata
      if ($um) { $pt = [double]$um.promptTokenCount; $ct = [double]$um.cachedContentTokenCount; $tt = [double]$um.toolUsePromptTokenCount; $ot = [double]$um.candidatesTokenCount; $th = [double]$um.thoughtsTokenCount; $tot = [double]$um.totalTokenCount }
      $mv = $j.modelVersion
    } catch { }
  }
  if ($tot -eq 0) { $tot = $pt + $tt + $ot + $th }
  # the tier Google says it served (a Priority request can be served, and billed, as Standard)
  if (-not $tierHdr) { $tierHdr = $reqTier }
  $tierHdr = ([string]$tierHdr).ToLower()
  $pr = Get-Price $c $model $tierHdr
  $usd = [math]::Round((($pt - $ct + $tt) * $pr[0] + $ct * $pr[1] + ($ot + $th) * $pr[2]) / 1e6, 6)
  $final = $status; if ($billing -and -not $used) { $final = 402 }
  $kindOut = 'ok'; $errOut = $null
  if (-not $used) { $kindOut = $kind; $errOut = $google }
  $fb = 'false'; if ($model -ne $first) { $fb = 'true' }
  $af = 'false'; if ($autoFallback) { $af = 'true' }
  $entry = '{"time":' + (Get-JsonText ([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', $Inv))) + ',"day":' + (Get-JsonText $day) + ',"model":' + (Get-JsonText $model) +
    ',"preferred_model":' + (Get-JsonText $first) + ',"requested_model":' + (Get-JsonText $c.model) + ',"fallback":' + $fb + ',"auto_fallback":' + $af + ',"tried":' + (Get-JsonText $triedText) +
    ',"model_version":' + (Get-JsonText $mv) + ',"thinking":' + (Get-JsonText $level) + ',"tier_requested":' + (Get-JsonText $reqTier) + ',"tier":' + (Get-JsonText $tierHdr) + ',"status":' + $final + ',"kind":' + (Get-JsonText $kindOut) + ',"attempts":' + $tried.Count + ',"ms":' + $elapsed +
    ',"input":' + (Get-Num ($pt + $tt)) + ',"cached":' + (Get-Num $ct) + ',"output":' + (Get-Num $ot) + ',"thinking_tokens":' + (Get-Num $th) + ',"total":' + (Get-Num $tot) + ',"usd":' + (Get-Num $usd) +
    ',"currency":' + (Get-JsonText $c.curCode) + ',"cost":' + (Get-Num ([math]::Round($usd * $c.perUsd, 6))) + ',"error":' + (Get-JsonText $errOut) + '}'
  try { [IO.File]::AppendAllText($AssistantLog, $entry + "`n", (New-Object System.Text.UTF8Encoding($false))) } catch { }
  $usage = $entry.Substring(0, $entry.Length - 1) + ',"today":' + (Get-TodayJson (Get-AssistantToday $day $c.perUsd)) + '}'
  if (-not $used) {
    $code = $final
    if ($kind -eq 'overloaded') { $code = 503 } elseif ($kind -eq 'rate_limit') { $code = 429 } elseif ($kind -eq 'timeout') { $code = 504 } elseif ($kind -eq 'network') { $code = 502 } elseif ($kind -eq 'billing') { $code = 402 }
    $msg = Get-FailMessage $kind $final $google $triedText $c
    Send-Json $res $code ('{"error":{"message":' + (Get-JsonText $msg) + ',"kind":' + (Get-JsonText $kind) + ',"status":' + $final + ',"tried":' + (Get-JsonText $triedText) + '},"atlasUsage":' + $usage + '}')
    return
  }
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
