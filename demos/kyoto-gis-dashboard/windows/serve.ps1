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
# The assistant's relay (the same as server/assistantRelay.js for the dev server). The page posts the
# conversation to /api/assistant on this computer; this script adds the Gemini API key from this
# computer's environment (GEMINI_API_KEY, set once with setx) and passes it on to Google. The key never
# reaches the browser and is not in any file of the site. GEMINI_MODEL picks another model (default
# gemini-4-hydrogen); GEMINI_API_BASE is only for tests.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
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
function Invoke-AssistantRelay($ctx) {
  $res = $ctx.Response
  $model = Get-UserSetting 'GEMINI_MODEL'
  if (-not $model) { $model = 'gemini-4-hydrogen' }
  $key = Get-UserSetting 'GEMINI_API_KEY'
  if ($ctx.Request.Url.AbsolutePath.EndsWith('/status')) {
    $conf = 'false'; if ($key) { $conf = 'true' }
    Send-Json $res 200 ('{"configured":' + $conf + ',"model":"' + $model + '"}'); return
  }
  if ($ctx.Request.HttpMethod -ne 'POST') { Send-Json $res 405 '{"error":{"message":"Use POST."}}'; return }
  $ms = New-Object System.IO.MemoryStream
  $ctx.Request.InputStream.CopyTo($ms)
  if ($ms.Length -gt 2MB) { Send-Json $res 413 '{"error":{"message":"The conversation is too long."}}'; return }
  if (-not $key) { Send-Json $res 503 '{"error":{"message":"GEMINI_API_KEY is not set on this computer. See Support for how to add it."}}'; return }
  $base = Get-UserSetting 'GEMINI_API_BASE'
  if (-not $base) { $base = 'https://generativelanguage.googleapis.com' }
  $req = [System.Net.HttpWebRequest]::Create($base.TrimEnd('/') + '/v1beta/models/' + [Uri]::EscapeDataString($model) + ':generateContent')
  $req.Method = 'POST'
  $req.ContentType = 'application/json'
  $req.Headers.Add('x-goog-api-key', $key)
  $req.Timeout = 120000
  $body = $ms.ToArray()
  $req.ContentLength = $body.Length
  try {
    $rs = $req.GetRequestStream(); $rs.Write($body, 0, $body.Length); $rs.Close()
    try { $resp = $req.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response; if (-not $resp) { throw } }
    $out = New-Object System.IO.MemoryStream
    $resp.GetResponseStream().CopyTo($out)
    $res.StatusCode = [int]$resp.StatusCode
    $resp.Close()
    $res.ContentType = 'application/json; charset=utf-8'
    $bytes = $out.ToArray()
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    Send-Json $res 502 '{"error":{"message":"Could not reach the Gemini API from this computer."}}'
  }
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
