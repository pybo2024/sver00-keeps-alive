#!/bin/bash
# 字体上色
A() {
    echo -e "\033[32m$1\033[0m"
}
B() {
    echo -e "\033[31m$1\033[0m"
}
C() {
    local D=$(hostname)
    local E=$(echo "$D" | awk -F'[s.]' '{print $2}')
    local F=("cache${E}.serv00.com" "web${E}.serv00.com" "$D")
    for G in "${F[@]}"; do
        local H=$(curl -s --max-time 10 "https://ss.serv0.us.kg/api/getip?host=$G")
        if [[ "$H" =~ "not found" ]]; then
            echo "未识别主机 ${G}！"
            continue
        fi
        local I=$(echo "$H" | awk -F "|" '{print $1}')
        local J=$(echo "$H" | awk -F "|" '{print $2}')
        if [[ "$J" == "Accessible" ]]; then
            echo "$I"
            return 0
        fi
    done
    echo ""  
    return 1  
}
K() {
    local L="$1"
    local M="$2"
    if [[ ! -f "$L" ]]; then
        B "配置文件 $L 不存在！"
        return 1
    fi
    jq --arg N "$M" '
        (.inbounds[] | select(.tag == "hysteria-in") | .listen) = $N
    ' "$L" > temp.json && mv temp.json "$L"

    if [[ $? -eq 0 ]]; then
        A "SingBox 配置文件成功更新IP为 $M"
    else
        B "更新配置文件失败！"
        return 1
    fi
}
O() {
    local P="$1"
    local Q="$2"
    if [[ ! -f "$P" ]]; then
        B "配置文件 $P 不存在！"
        return 1
    fi
    jq --arg R "$Q" '
        .HY2IP = $R
    ' "$P" > temp.json && mv temp.json "$P"

    if [[ $? -eq 0 ]]; then
        A "Config 配置文件成功更新IP为 $Q"
    else
        B "更新配置文件失败！"
        return 1
    fi
}
S() {
    local T="$HOME/serv00-play/singbox/config.json"
    local U="$HOME/serv00-play/singbox/singbox.json"
    local V=$(C)
    echo "有效 IP: $V"
    if [[ -z "$V" ]]; then
        B "没有可用 IP！"
        return 1  
    fi
    K "$T" "$V"
    O "$U" "$V"
    echo "正在重启 sing-box..."
    W
    sleep 5
    X
}
W() {
    cd ~/serv00-play/singbox/ && bash killsing-box.sh
}
X() {
    cd ~/serv00-play/singbox/ && bash start.sh
}
S
