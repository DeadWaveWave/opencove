// npm/cmd-shim 6.0.3 and 8.0.0, lib/index.js. Match the WHOLE no-flags Node shim,
// not a target-looking line inside an arbitrary batch program. Never execute the batch.
export const npmNodeCmdPrefix = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
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
export const npmNodeCmdSuffix = '" %*\n'
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
export const npmNodeCmdPattern = `\\A${escapeRegex(npmNodeCmdPrefix)}(?<target>[^"%\\r\\n]+)${escapeRegex(npmNodeCmdSuffix)}\\z`

const npmNodePs1Template =
  '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n  # Fix case when both the Windows and Linux builds of Node\n  # are installed in the same directory\n  $exe=".exe"\n}\n$ret=0\nif (Test-Path "$basedir/node$exe") {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "$basedir/node$exe"  "$basedir/__TARGET__" $args\n  } else {\n    & "$basedir/node$exe"  "$basedir/__TARGET__" $args\n  }\n  $ret=$LASTEXITCODE\n} else {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "node$exe"  "$basedir/__TARGET__" $args\n  } else {\n    & "node$exe"  "$basedir/__TARGET__" $args\n  }\n  $ret=$LASTEXITCODE\n}\nexit $ret\n'
export const npmNodePs1Pattern = `\\A${escapeRegex(npmNodePs1Template)
  .split('__TARGET__')
  .map((part, index) =>
    index === 0 ? part : (index === 1 ? '(?<target>[^"\\r\\n]+)' : '\\k<target>') + part,
  )
  .join('')}\\z`
