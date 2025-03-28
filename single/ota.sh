#!/bin/bash

# 配置变量
USER=$(whoami)
USER_NAME=$(echo "$USER" | tr '[:upper:]' '[:lower:]')  # 获取当前用户名并转换为小写
REPO_PATH="$HOME/serv00-save-me"
SINGLE_PATH="$REPO_PATH/single"
TARGET_PATH="/home/$USER/domains/$USER_NAME.serv00.net/public_nodejs"
BRANCH="main"  # 根据你的仓库调整分支

# 设置 GIT_DISCOVERY_ACROSS_FILESYSTEM 环境变量（避免跨文件系统的错误）
export GIT_DISCOVERY_ACROSS_FILESYSTEM=1

# 进入仓库目录
cd "$REPO_PATH" || { echo "🚫 目录不是 Git 环境！"; exit 1; }

# 检查仓库是否正确初始化
if [ ! -d ".git" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🚫 运行环境错误"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

# 记录 single 目录下的变动文件，排除 .sh 和 .md 文件
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 开始 检查更新....."
git fetch origin "$BRANCH" >/dev/null 2>&1
CHANGED_FILES=$(git diff --name-only origin/"$BRANCH" -- single | grep -Ev '\.sh$|\.md$')

# 如果没有文件变动，则退出
if [ -z "$CHANGED_FILES" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ 文件均为最新！"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
fi

# 打印有文件更新
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 发现 有文件更新："
for file in $CHANGED_FILES; do
    RELATIVE_PATH=$(echo "$file" | sed -e 's/^single\///' -e 's/^public\///')
    echo "🎯 $RELATIVE_PATH"
done

# 先存储本地修改，避免冲突
git stash >/dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🚫 更新失败！"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

# 拉取最新代码
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚙️ 下载文件更新中....."
git reset --hard origin/"$BRANCH" >/dev/null 2>&1

# 遍历变更的文件并复制到目标路径
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 正在更新文件中....."
for file in $CHANGED_FILES; do
    RELATIVE_PATH=${file#single/}  # 去掉 "single/" 前缀
    TARGET_FILE="$TARGET_PATH/$RELATIVE_PATH"  # 保持相对路径一致

    rm -f "$SINGLE_PATH/ota.sh" "$SINGLE_PATH/hy2ip.sh" "$SINGLE_PATH/install.sh" "$REPO_PATH/README.md";

    # 如果是文件删除（在仓库中删除），则删除目标路径的文件
    if ! git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
        if [ -f "$TARGET_FILE" ]; then
            rm -f "$TARGET_FILE"
            echo "🗑️ 清理无效文件：$(basename "$TARGET_FILE")"
        fi
    else
        # 复制文件
        cp -f "$SINGLE_PATH/$RELATIVE_PATH" "$TARGET_FILE"
        echo "✅ 已更新：$(basename "$TARGET_FILE")"
    fi
done    

# 更新完成后重启服务
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 重启web服务"
devil www restart "$USER_NAME.serv00.net" >/dev/null 2>&1
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 全部更新完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
