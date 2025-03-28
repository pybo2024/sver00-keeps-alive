#!/bin/bash

X() {
    local Y=$1
    local CMD=$2
    local O=("▖" "▘" "▝" "▗")
    local i=0

    printf "[ ] %s" "$Y"

    eval "$CMD" > /dev/null 2>&1 &
    local PID=$!
    
    while kill -0 "$PID" 2>/dev/null; do
        printf "\r[%s] %s" "${O[i]}" "$Y"
        i=$(( (i + 1) % 4 ))
        sleep 0.1
    done

    wait "$PID"
    local EXIT_CODE=$?

    printf "\r                       \r"
    if [[ $EXIT_CODE -eq 0 ]]; then
        printf "[\033[0;32mOK\033[0m] %s\n" "$Y"
    else
        printf "[\033[0;31mNO\033[0m] %s\n" "$Y"
    fi
}

U=$(whoami)
V=$(echo "$U" | tr '[:upper:]' '[:lower:]')
W="$V.serv00.net"
A1="/home/$U/domains/$W"
A2="$A1/public_nodejs"
B1="$A2/public"
A3="https://github.com/ryty1/serv00-save-me.git"

echo "请选择保活类型："
echo "1. 本机保活"
echo "2. 账号服务"
echo "3. 一键卸载"
read -p "请输入选择: " choice

if [[ "$choice" -eq 3 ]]; then
    # **一键卸载**
    if [[ -d "$HOME/serv00-save-me" ]]; then
        X "删除 类型域名" "cd && devil www del \"$W\""
        
        if [[ -d "$A1" ]]; then
            rm -rf "$A1"
        fi

        X "恢复 默认域名" "devil www add \"$W\" php"

        if [[ -d "$B1" ]]; then
            rm -rf "$B1"
        fi

        X "脚本 卸载完成" "rm -rf "$HOME/serv00-save-me""
    else
        echo "🚫 未安装，无需卸载"
    fi
    exit 0
    
fi

# **安装逻辑**
if [[ "$choice" -eq 1 ]]; then
    TARGET_FOLDER="single"
    DELETE_FOLDER="server"
    DEPENDENCIES="dotenv basic-auth express"
    echo "开始进行 本机保活配置"
elif [[ "$choice" -eq 2 ]]; then
    TZ_MODIFIED=0
    if [[ "$(date +%Z)" != "CST" ]]; then
        export TZ='Asia/Shanghai'
        echo "export TZ='Asia/Shanghai'" >> ~/.profile
        source ~/.profile
        TZ_MODIFIED=1
    fi
    
    TARGET_FOLDER="server"
    DELETE_FOLDER="single"
    DEPENDENCIES="body-parser express-session session-file-store dotenv express socket.io node-cron node-telegram-bot-api axios"
    echo "开始进行 账号服务配置"
else
    echo "无效选择，退出脚本"
    exit 1
fi

echo " ———————————————————————————————————————————————————————————— "

X "删除 默认域名" "cd && devil www del \"$W\""

if [[ -d "$A1" ]]; then
    rm -rf "$A1"
fi

X "创建 类型域名" "devil www add \"$W\" nodejs /usr/local/bin/node22"

if [[ -d "$B1" ]]; then
    rm -rf "$B1"
fi

cd "$A2" && npm init -y > /dev/null 2>&1
X "安装 环境依赖" "npm install $DEPENDENCIES"

# 使用 sparse-checkout 来只拉取指定文件夹
cd && git clone --no-checkout "$A3" "$HOME/serv00-save-me" > /dev/null 2>&1
cd "$HOME/serv00-save-me" || exit 1

# 配置 sparse-checkout，拉取指定文件夹
git sparse-checkout init --cone
git sparse-checkout set "$TARGET_FOLDER"  # 只拉取 single 或 server 文件夹

# 拉取完成后，删除仓库的临时文件夹
git checkout main > /dev/null 2>&1
cd "$HOME" || exit 1

# 复制拉取到的文件到目标目录并保留结构
if [[ -d "$HOME/serv00-save-me" ]]; then
    cp -r "$HOME/serv00-save-me/$TARGET_FOLDER/." "$A2/"
else
    exit 1
fi

# 复制到目标目录
X "下载 配置文件"

rm -f "$HOME/serv00-save-me/README.md"

# 删除不需要的文件
if [[ "$choice" -eq 1 ]]; then
    for file in "$A2/install.sh" "$A2/hy2ip.sh" "$A2/ota.sh" "$HOME/serv00-save-me/single/install.sh" "$HOME/serv00-save-me/single/hy2ip.sh" "$HOME/serv00-save-me/single/ota.sh"; do
        rm -f "$file"
    done
    chmod 755 "$A2/app.js" > /dev/null 2>&1
    echo ""
    echo " ┌───────────────────────────────────────────────────┐ "
    echo " │ 【 恭 喜 】  本机保活 部署已完成                  │ "
    echo " ├───────────────────────────────────────────────────┤ "
    echo " │  保活地址：                                       │ "
    printf " │  → %-46s │\n" "https://$W/info"
    echo " └───────────────────────────────────────────────────┘ "
    echo ""

else
    for file in "$A2/ota.sh" "$HOME/serv00-save-me/server/ota.sh"; do
        rm -f "$file"
    done
    chmod 755 "$A2/app.js" > /dev/null 2>&1

    echo ""
    echo " ┌───────────────────────────────────────────────────┐ "
    echo " │ 【 恭 喜 】  账号服务 部署已完成                  │ "
    echo " ├───────────────────────────────────────────────────┤ "
    echo " │  账号服务 只要部署1个，多了无用                   │ "
    echo " ├───────────────────────────────────────────────────┤ "
    echo " │  服务地址：                                       │ "
    printf " │  → %-46s │\n" "https://$W/"
    echo " └───────────────────────────────────────────────────┘ "
    echo ""
fi

# 如果时区被修改，提示用户重新登录
if [[ "$TZ_MODIFIED" -eq 1 ]]; then
    echo " ┌───────────────────────────────────────────────────┐ "
    echo " │   全部安装完成，还需其它操作请重登陆              │ "
    echo " └───────────────────────────────────────────────────┘ "
    sleep 3
    kill -9 $PPID
fi
