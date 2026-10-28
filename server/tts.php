<?php
declare(strict_types=1);
/*
 * CloudCut — lektor: tekst na mowę głosami zainstalowanymi w Windows (np. „Microsoft Paulina” po polsku).
 * Działa na komputerze użytkownika, bez internetu. Tekst trafia do PowerShella przez wejście standardowe,
 * a dźwięk WAV wraca na wyjściu jako base64 — żadne dane użytkownika nie są częścią polecenia.
 */

const TTS_MAX_CHARS = 3000;

class TtsError extends RuntimeException {}

function ttsPowerShell(): string {
    $root = getenv('SystemRoot') ?: 'C:\\Windows';
    return $root . '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
}

/** Uruchamia skrypt PowerShella (stały tekst) z danymi na wejściu; zwraca wyjście */
function ttsRun(string $script, string $stdin = '', array $vars = []): string {
    if (PHP_OS_FAMILY !== 'Windows') throw new TtsError('Lektor działa w aplikacji CloudCut na Windows.');
    $enc = base64_encode(mb_convert_encoding($script, 'UTF-16LE', 'UTF-8'));
    $env = array_merge(getenv(), $vars);
    $p = @proc_open([ttsPowerShell(), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $enc],
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env, ['bypass_shell' => true]);
    if (!is_resource($p)) throw new TtsError('Nie udało się uruchomić syntezy mowy Windows.');
    fwrite($pipes[0], $stdin);
    fclose($pipes[0]);
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $code = proc_close($p);
    if ($code !== 0) throw new TtsError('Synteza mowy nie zadziałała' . (trim((string) $err) !== '' ? ': ' . mb_substr(trim(preg_replace('/\s+/', ' ', (string) $err)), 0, 200) : '.'));
    return (string) $out;
}

/** Głosy zainstalowane w systemie: [{name, lang, gender}] */
function ttsVoices(): array {
    $out = ttsRun(<<<'PS'
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
foreach ($v in $s.GetInstalledVoices()) { if ($v.Enabled) { [Console]::Out.WriteLine($v.VoiceInfo.Name + '|' + $v.VoiceInfo.Culture.Name + '|' + $v.VoiceInfo.Gender) } }
$s.Dispose()
PS);
    $list = [];
    foreach (preg_split('/\r?\n/', trim($out)) as $line) {
        $p = explode('|', trim($line));
        if (count($p) === 3 && $p[0] !== '') $list[] = ['name' => $p[0], 'lang' => $p[1], 'gender' => $p[2]];
    }
    return $list;
}

/** Tekst → WAV (bajty). Głos musi być jednym z zainstalowanych, tempo od −10 do 10 */
function ttsSpeak(string $text, string $voice, int $rate): string {
    $text = trim(preg_replace('/[^\P{C}\n\t]/u', ' ', $text) ?? '');
    if ($text === '') throw new TtsError('Wpisz tekst do przeczytania.');
    if (mb_strlen($text) > TTS_MAX_CHARS) throw new TtsError('Tekst jest za długi — najwięcej ' . TTS_MAX_CHARS . ' znaków naraz.');
    if ($voice !== '' && !in_array($voice, array_column(ttsVoices(), 'name'), true)) throw new TtsError('Nie ma takiego głosu w systemie.');
    $b64 = ttsRun(<<<'PS'
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:CC_TTS_VOICE) { $s.SelectVoice($env:CC_TTS_VOICE) }
$s.Rate = [int]$env:CC_TTS_RATE
$ms = New-Object System.IO.MemoryStream
$s.SetOutputToWaveStream($ms)
$s.Speak([Console]::In.ReadToEnd())
$s.Dispose()
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
PS, $text, ['CC_TTS_VOICE' => $voice, 'CC_TTS_RATE' => (string) max(-10, min(10, $rate))]);
    $wav = base64_decode(trim($b64), true);
    if ($wav === false || strlen($wav) < 100 || substr($wav, 0, 4) !== 'RIFF') throw new TtsError('Synteza mowy nie zwróciła dźwięku.');
    return $wav;
}
