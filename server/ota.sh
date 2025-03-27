#!/bin/bash

# 配置变量
USER=$(whoami)
USER_NAME=$(echo "$USER" | tr '[:upper:]' '[:lower:]')  # 获取当前用户名并转换为小写
REPO_PATH="/home/$USER/serv00-save-me"
SERVER_PATH="$REPO_PATH/server"
TARGET_PATH="/home/$USER/domains/$USER_NAME.serv00.net/public_nodejs"
BRANCH="main"  # 根据你的仓库调整分支

# 设置 GIT_DISCOVERY_ACROSS_FILESYSTEM 环境变量（避免跨文件系统的错误）
export GIT_DISCOVERY_ACROSS_FILESYSTEM=1

# 进入仓库目录
cd "$REPO_PATH" || { echo "目录不是 Git 环境！"; exit 1; }

# 检查仓库是否正确初始化
if [ ! -d ".git" ]; then
    echo "运行环境错误"
    exit 1
fi

# 记录 server 目录下的变动文件，排除 .sh 和 .md 文件
echo "检查 文件更新....."
git fetch origin "$BRANCH" >/dev/null 2>&1
CHANGED_FILES=$(git diff --name-only origin/"$BRANCH" -- server | grep -Ev '\.sh$|\.md$')

# 如果没有文件变动，则退出
if [ -z "$CHANGED_FILES" ]; then
    echo "文件均为最新"
    exit 0
fi

# 打印有文件更新
echo "发现 有文件更新："
echo "$(basename "$CHANGED_FILES")"


# 先存储本地修改，避免冲突
git stash >/dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "更新失败！"
    exit 1
fi

# 拉取最新代码
echo "拉取文件更新中....."
git reset --hard origin/"$BRANCH" >/dev/null 2>&1

# 遍历变更的文件并复制到目标路径
echo "正在更新文件中....."
for file in $CHANGED_FILES; do
    RELATIVE_PATH=${file#server/}  # 去掉 "server/" 前缀
    TARGET_FILE="$TARGET_PATH/$RELATIVE_PATH"  # 保持相对路径一致

    # 如果是文件删除（在仓库中删除），则删除目标路径的文件
    if ! git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
        if [ -f "$TARGET_FILE" ]; then
            rm -f "$TARGET_FILE"  # 删除文件
            echo "清理无效文件：$(basename "$TARGET_FILE")"
        fi
    else
        # 复制文件
        cp -f "$SERVER_PATH/$RELATIVE_PATH" "$TARGET_FILE"
        echo "已更新：$(basename "$TARGET_FILE")"
    fi
done

# 更新完成后重启服务
echo "全部更新完成，重启web服务"
devil www restart "$USER_NAME.serv00.net" >/dev/null 2>&1

echo "同步完成！"
