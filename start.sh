#!/bin/bash
# OpenCove 起動スクリプト（VcXsrv 自動起動版）

# VcXsrv の起動確認と起動
if ! pgrep -q "vcxsrv|XLaunch"; then
    echo "🔄 VcXsrv を起動中..."
    # Windows 側で VcXsrv を起動（wmic を使用してプロセス終了も可能）
    wslvar VCXSRV_PATH="C:/Program Files/VcXsrv/vcxsrv.exe"
    if [ -f "$VCXSRV_PATH" ]; then
        start "" "$VCXSRV_PATH" :0 -ac &
        sleep 2
        echo "✅ VcXsrv 起動完了"
    else
        # 別のパスを試す
        wslvar VCXSRV_PATH_ALT="C:/Program Files (x86)/VcXsrv/vcxsrv.exe"
        if [ -f "$VCXSRV_PATH_ALT" ]; then
            start "" "$VCXSRV_PATH_ALT" :0 -ac &
            sleep 2
            echo "✅ VcXsrv 起動完了（代替パス）"
        else
            echo "⚠️ VcXsrv がインストールされていない可能性があります"
            echo "   Windows で手動で VcXsrv/XLaunch を起動してください"
        fi
    fi
else
    echo "ℹ️ VcXsrv は既に起動しています"
fi

# OpenCove の起動
cd /home/hebinoyouboku/.openclaw/workspace/opencove || exit 1
export DISPLAY=:0
echo "🚀 OpenCove を起動中..."
pnpm dev
