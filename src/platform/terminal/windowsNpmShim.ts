// npm/cmd-shim 6.0.3 and 8.0.0, lib/index.js. Match complete upstream templates,
// not a target-looking line inside an arbitrary wrapper. Never execute the wrapper.
const npmCmdHeader = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
].join('\n')
const npmNodeCmdBody = [
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\',
].join('\n')
const npmNodeCmdSuffix = '" %*\n'
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
// The no-shebang template invokes a relative executable with no flags. Keep the
// capture literal: no alternate streams, shell expansions or rooted paths.
const nativeLeaf = String.raw`[-A-Za-z0-9_@. ]+\.[eE][xX][eE]`
const nativeCmdTarget = String.raw`(?:[-A-Za-z0-9_@. ]+\\)*${nativeLeaf}`
const nativePs1Target = String.raw`(?:[-A-Za-z0-9_@. ]+/)*${nativeLeaf}`
const npmNativeCmdBody =
  escapeRegex('"%dp0%\\') + `(?<nativeTarget>${nativeCmdTarget})` + escapeRegex('"   %*\n')
const npmNodeCmdPattern = `${escapeRegex(npmNodeCmdBody)}(?<target>[^"%\\r\\n]+)${escapeRegex(npmNodeCmdSuffix)}`
export const npmCmdPattern = `\\A${escapeRegex(npmCmdHeader)}(?:${npmNativeCmdBody}|${npmNodeCmdPattern})\\z`

const npmPs1Header =
  '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n  # Fix case when both the Windows and Linux builds of Node\n  # are installed in the same directory\n  $exe=".exe"\n}\n'
const npmNodePs1Body =
  '$ret=0\nif (Test-Path "$basedir/node$exe") {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "$basedir/node$exe"  "$basedir/__TARGET__" $args\n  } else {\n    & "$basedir/node$exe"  "$basedir/__TARGET__" $args\n  }\n  $ret=$LASTEXITCODE\n} else {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "node$exe"  "$basedir/__TARGET__" $args\n  } else {\n    & "node$exe"  "$basedir/__TARGET__" $args\n  }\n  $ret=$LASTEXITCODE\n}\nexit $ret\n'
const npmNativePs1Body =
  '# Support pipeline input\nif ($MyInvocation.ExpectingInput) {\n  $input | & "$basedir/__TARGET__"   $args\n} else {\n  & "$basedir/__TARGET__"   $args\n}\nexit $LASTEXITCODE\n'
function repeatedTarget(body: string, group: string, target: string): string {
  return escapeRegex(body)
    .split('__TARGET__')
    .map((part, index) =>
      index === 0 ? part : (index === 1 ? `(?<${group}>${target})` : `\\k<${group}>`) + part,
    )
    .join('')
}
const nativePs1Pattern = repeatedTarget(npmNativePs1Body, 'nativeTarget', nativePs1Target)
const nodePs1Pattern = repeatedTarget(npmNodePs1Body, 'target', '[^"\\r\\n]+')
export const npmPs1Pattern = `\\A${escapeRegex(npmPs1Header)}(?:${nativePs1Pattern}|${nodePs1Pattern})\\z`
