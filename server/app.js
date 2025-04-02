const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const http = require("http");
const { exec } = require("child_process");
const socketIo = require("socket.io");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const bodyParser = require("body-parser");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");
const SETTINGS_FILE = path.join(__dirname, "settings.json");
const PASSWORD_FILE = path.join(__dirname, "password.json");
const SESSION_DIR = path.join(__dirname, "sessions"); 
const SESSION_FILE = path.join(__dirname, "session_secret.json");
const otaScriptPath = path.join(__dirname, 'ota.sh');

app.use(express.json()); 
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});

function getSessionSecret() {
    if (fs.existsSync(SESSION_FILE)) {
        return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8")).secret;
    } else {
        const secret = crypto.randomBytes(32).toString("hex");
        fs.writeFileSync(SESSION_FILE, JSON.stringify({ secret }), "utf-8");
        return secret;
    }
}

app.use(session({
    store: new FileStore({
        path: path.join(__dirname, "sessions"), 
        ttl: 60 * 60,  
        retries: 0,
        clearInterval: 3600 
    }),
    secret: getSessionSecret(), 
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true }
}));

app.use(bodyParser.urlencoded({ extended: true }));

function checkPassword(req, res, next) {
    if (!fs.existsSync(PASSWORD_FILE)) {
        return res.redirect("/setPassword");
    }
    next();
}

app.get("/checkSession", (req, res) => {
    if (req.session.authenticated) {
        res.status(200).json({ authenticated: true });
    } else {
        res.status(401).json({ authenticated: false });
    }
});

function isAuthenticated(req, res, next) {
    if (req.session.authenticated) {
        return next();
    }
    res.redirect("/login");  
}

app.get("/setPassword", (req, res) => {
    res.sendFile(path.join(__dirname, "protected", "set_password.html"));
});

app.post("/setPassword", (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).send("密码不能为空");
    }
    fs.writeFileSync(PASSWORD_FILE, JSON.stringify({ password }), "utf-8");
    res.redirect("/login");
});

const errorCache = new Map(); 

async function sendErrorToTG(user, status, message) {
    try {
        const settings = getNotificationSettings();
        if (!settings.telegramToken || !settings.telegramChatId) {
            console.log("❌ Telegram 设置不完整，无法发送通知");
            return;
        }

        const now = Date.now();
        const cacheKey = `${user}:${status}`;
        const lastSentTime = errorCache.get(cacheKey);

        if (status === 404) {
            // **如果404状态已经发送过，则直接跳过**
            if (lastSentTime) {
                console.log(`⏳ 404 状态已发送过 ${user}，跳过通知`);
                return;
            }
            // **记录404状态发送时间**
            errorCache.set(cacheKey, now);
        } else {
            // **非404状态：如果在3小时内发送过，则跳过**
            if (lastSentTime && now - lastSentTime < 3 * 60 * 60 * 1000) {
                console.log(`⏳ 3小时内已发送过 ${user} 的状态 ${status}，跳过通知`);
                return;
            }
            // **记录最新的非404状态发送时间**
            errorCache.set(cacheKey, now);
        }

        const bot = new TelegramBot(settings.telegramToken, { polling: false });
        const nowStr = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

        let titleBar, statusMessage, buttonText, buttonUrl;
        if (status === 403) {
            titleBar = "📥 Serv00 阵亡通知书";
            statusMessage = "账号已封禁";
            buttonText = "重新申请账号";
            buttonUrl = "https://www.serv00.com/offer/create_new_account";
        } else if (status === 404) {
            titleBar = "🟠 HtmlOnLive 提醒";
            statusMessage = "保活未安装";
            buttonText = "前往安装保活";
            buttonUrl = "https://github.com/ryty1/serv00-save-me";
        } else if (status >= 500 && status <= 599) {
            titleBar = "🔴 HtmlOnLive 失败通知";
            statusMessage = "服务器错误";
            buttonText = "查看服务器状态";
            buttonUrl = "https://ssss.nyc.mn/";
        } else {
            titleBar = "🔴 HtmlOnLive 失败通知";
            statusMessage = `访问异常`;
            buttonText = "手动进入保活";
            buttonUrl = `https://${user}.serv00.net/info`;
        }

        const formattedMessage = `
*${titleBar}*
——————————————————
👤 账号: \`${user}\`
📶 状态: *${statusMessage}*
📝 详情: *${status}*•\`${message}\`
——————————————————
🕒 时间: \`${nowStr}\``;

        const options = {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[{ text: buttonText, url: buttonUrl }]]
            }
        };

        await bot.sendMessage(settings.telegramChatId, formattedMessage, options);
        console.log(`✅ 已发送 Telegram 通知: ${user} - ${status}`);

    } catch (err) {
        console.error("❌ 发送 Telegram 通知失败:", err);
    }
}

app.get("/online", async (req, res) => {
    try {
        const accounts = await getAccounts(true);
        const users = Object.keys(accounts);

        const requests = users.map(user =>
            axios.get(`https://${user}.serv00.net/info`, {
                timeout: 10000,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                }
            })
            .then(response => {
                if (response.status === 200 && response.data) {
                    console.log(`✅ ${user} 保活成功，状态码: ${response.status}`);
                    console.log(`📄 ${user} 响应大小: ${response.data.length} 字节`);

                    // 模拟浏览器保持页面 3 秒
                    return new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    console.log(`❌ ${user} 保活失败，状态码: ${response.status}，无数据`);
                    sendErrorToTG(user, response.status, "响应数据为空");
                }
            })
            .catch(err => {
                if (err.response) {
                    console.log(`❌ ${user} 保活失败，状态码: ${err.response.status}`);
                    sendErrorToTG(user, err.response.status, err.response.statusText);
                } else {
                    console.log(`❌ ${user} 保活失败: ${err.message}`);
                    sendErrorToTG(user, "请求失败", err.message);
                }
            })
        );

        // 等待所有请求完成
        await Promise.allSettled(requests);

        console.log("✅ 所有账号的进程保活已访问完成");
        res.status(200).send("保活操作完成");  // 响应结束
    } catch (error) {
        console.error("❌ 访问 /info 失败:", error);
        sendErrorToTG("系统", "全局错误", error.message);
        res.status(500).send("系统错误");
    }
});

app.get("/login", async (req, res) => {
    res.sendFile(path.join(__dirname, "protected", "login.html"));
});

app.post("/login", (req, res) => {
    const { password } = req.body;
    if (!fs.existsSync(PASSWORD_FILE)) {
        return res.status(400).send("密码文件不存在，请先设置密码");
    }

    const savedPassword = JSON.parse(fs.readFileSync(PASSWORD_FILE, "utf-8")).password;
    if (password === savedPassword) {
        req.session.authenticated = true;
        res.redirect("/");
    } else {
        res.status(401).send("密码错误");
    }
});

app.get("/logout", (req, res) => {
    try {
        if (fs.existsSync(SESSION_DIR)) {
            fs.readdirSync(SESSION_DIR).forEach(file => {
                const filePath = path.join(SESSION_DIR, file);
                if (file.endsWith(".json")) {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);  
                        console.log("已删除 session 登录密钥文件");
                    }
                }
            });
        }
    } catch (error) {
        console.error("删除 session 文件失败:", error);
    }

    req.session.destroy(() => {
        res.redirect("/login");
    });
});


const protectedRoutes = ["/", "/ota", "/accounts", "/nodes", "/online"];
protectedRoutes.forEach(route => {
    app.get(route, checkPassword, isAuthenticated, (req, res) => {
        res.sendFile(path.join(__dirname, "protected", route === "/" ? "index.html" : `${route.slice(1)}.html`));
    });
});

const MAIN_SERVER_USER = process.env.USER || process.env.USERNAME || "default_user"; 
async function getAccounts(excludeMainUser = true) {
    if (!fs.existsSync(ACCOUNTS_FILE)) return {};
    let accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf-8"));
    if (excludeMainUser) {
        delete accounts[MAIN_SERVER_USER];  
    }
    return accounts;
}

io.on("connection", (socket) => {
    console.log("Client connected");
    socket.on("startNodesSummary", () => {
        getNodesSummary(socket);
    });

    socket.on("loadAccounts", async () => {
        const accounts = await getAccounts(true);
        socket.emit("accountsList", accounts);
    });

    socket.on("saveAccount", async (accountData) => {
        const accounts = await getAccounts(false);
        accounts[accountData.user] = { 
            user: accountData.user, 
            season: accountData.season || ""  
        };
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
        socket.emit("accountsList", await getAccounts(true));
    });

    socket.on("deleteAccount", async (user) => {
        const accounts = await getAccounts(false);
        delete accounts[user];
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
        socket.emit("accountsList", await getAccounts(true));
    });

    socket.on("updateSeason", async (data) => {
        const accounts = await getAccounts(false);
        if (accounts[data.user]) {
            accounts[data.user].season = data.season; 
            fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
        }
        socket.emit("accountsList", await getAccounts(true));
    });
});

const SUB_FILE_PATH = path.join(__dirname, "sub.json");

function filterNodes(nodes) {
    return nodes.filter(node => node.startsWith("vmess://") || node.startsWith("hysteria2://"));
}

async function getNodesSummary(socket) {
    const accounts = await getAccounts(true);
    if (!accounts || Object.keys(accounts).length === 0) {
        console.log("⚠️ 未找到账号数据！");
        socket.emit("nodesSummary", { successfulNodes: { hysteria2: [], vmess: [] }, failedAccounts: [] });
        return;
    }

    const users = Object.keys(accounts); 
    let successfulNodes = { hysteria2: [], vmess: [] };
    let failedAccounts = [];

    for (let user of users) {
        const nodeUrl = `https://${user}.serv00.net/node`;
        try {
            console.log(`采集 ${user} 节点数据！`);
            const nodeResponse = await axios.get(nodeUrl, { timeout: 5000 });
            const nodeData = nodeResponse.data;

            const nodeLinks = filterNodes([
                ...(nodeData.match(/vmess:\/\/[^\s<>"]+/g) || []),
                ...(nodeData.match(/hysteria2:\/\/[^\s<>"]+/g) || [])
            ]);

            nodeLinks.forEach(link => {
                if (link.startsWith("hysteria2://")) {
                    successfulNodes.hysteria2.push(link);
                } else if (link.startsWith("vmess://")) {
                    successfulNodes.vmess.push(link);
                }
            });

            if (nodeLinks.length === 0) {
                console.log(`账号 ${user} 连接成功但无有效节点`);
                failedAccounts.push(user);
            }
        } catch (error) {
            console.log(`账号 ${user} 获取节点失败: ${error.message}`);
            failedAccounts.push(user);
        }
    }

    // 整理成 Base64 订阅格式
    const allNodes = [...successfulNodes.hysteria2, ...successfulNodes.vmess].join("\n");
    const base64Sub = Buffer.from(allNodes).toString("base64");

    // 生成 `sub.json`
    const subData = { sub: base64Sub };
    fs.writeFileSync(SUB_FILE_PATH, JSON.stringify(subData, null, 4));

    console.log("订阅文件 sub.json 已更新！");

    socket.emit("nodesSummary", { successfulNodes, failedAccounts });
}

io.on("connection", (socket) => {
    console.log("客户端已连接");

    socket.on("startNodesSummary", async () => {
        await getNodesSummary(socket);
    });
});

app.get('/sub', (req, res) => {
    try {
        const subData = JSON.parse(fs.readFileSync('sub.json', 'utf8')); // 解析 JSON
        if (subData.sub) {
            res.setHeader('Content-Type', 'text/plain'); // 纯文本
            res.send(subData.sub); // 只返回 Base64 订阅内容
        } else {
            res.status(500).send('订阅内容为空');
        }
    } catch (err) {
        res.status(500).send('订阅文件读取失败');
    }
});

let cronJob = null;

function getNotificationSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
}

function saveNotificationSettings(settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function resetCronJob() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }

    const settings = getNotificationSettings();
    if (!settings || !settings.cronEnabled || !settings.cronExpression) return;

    if (!cron.validate(settings.cronExpression)) {
        return console.error("❌ 无效的 cron 表达式:", settings.cronExpression);
    }

    cronJob = cron.schedule(settings.cronExpression, () => {
        console.log("⏰ 运行通知任务...");
        sendCheckResultsToTG();
    });

    console.log("✅ 定时任务已启动:", settings.cronExpression);
}

app.post("/setTelegramSettings", (req, res) => {
    const { telegramToken, telegramChatId } = req.body;
    if (!telegramToken || !telegramChatId) {
        return res.status(400).json({ message: "Telegram 配置不完整" });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ telegramToken, telegramChatId }, null, 2));
    res.json({ message: "Telegram 设置已更新" });
});
app.get("/getTelegramSettings", (req, res) => {
    if (!fs.existsSync(SETTINGS_FILE)) {
        return res.json({ telegramToken: "", telegramChatId: "" });
    }
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    res.json(settings);
});

async function sendCheckResultsToTG() {
    try {
        const settings = getNotificationSettings();
        if (!settings.telegramToken || !settings.telegramChatId) {
            console.log("❌ Telegram 设置不完整，无法发送通知");
            return;
        }

        const bot = new TelegramBot(settings.telegramToken, { polling: false });
        const response = await axios.post(`https://${process.env.USER}.serv00.net/checkAccounts`, {});
        const data = response.data.results;

        if (!data || Object.keys(data).length === 0) {
            await bot.sendMessage(settings.telegramChatId, "📋 账号检测结果：没有账号需要检测", { parse_mode: "MarkdownV2" });
            return;
        }

        let results = [];
        let maxUserLength = 0;
        let maxSeasonLength = 0;

        const users = Object.keys(data);  
        const maxIndexLength = String(users.length).length;

        users.forEach(user => {
            maxUserLength = Math.max(maxUserLength, user.length);
            maxSeasonLength = Math.max(maxSeasonLength, (data[user]?.season || "").length);
        });

        users.forEach((user, index) => {
            const paddedIndex = String(index + 1).padStart(maxIndexLength, "0");
            const paddedUser = user.padEnd(maxUserLength, " ");
            const season = (data[user]?.season || "--").padEnd(maxSeasonLength + 1, " ");
            const status = data[user]?.status || "未知状态";
            results.push(`${paddedIndex}. ${paddedUser} : ${season}- ${status}`);
        });

        const beijingTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
        let message = `㊙️ 账号检测结果：\n\n\`\`\`\n${results.join("\n")}\n\`\`\`\n\n⏰ 北京时间：${beijingTime}`;
        const options = {
            parse_mode: "MarkdownV2",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔍 其它账号检测", url: "https://checks.594880.xyz" }]
                ]
            }
        };

        await bot.sendMessage(settings.telegramChatId, message, options);

    } catch (error) {
        console.error("❌ 发送 Telegram 失败:", error);
    }
}

app.get("/", isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "protected", "index.html"));
});
app.get("/getMainUser", isAuthenticated, (req, res) => {
    res.json({ mainUser: MAIN_SERVER_USER });
});
app.get("/accounts", isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "protected", "accounts.html"));
});
app.get("/nodes", isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "protected", "nodes.html"));
});
app.get("/info", (req, res) => {
    const user = req.query.user;
    if (!user) return res.status(400).send("用户未指定");
    res.redirect(`https://${user}.serv00.net/info`);
});

app.get("/checkAccountsPage", isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "check_accounts.html"));
});

const statusMessages = {
    200: "账号正常",
    301: "账号未注册",
    302: "账号正常",
    403: "账号已封禁",
    404: "账号正常",
    500: "服务器错误",
    502: "网关错误",
    503: "VPS不可用",
    504: "网关超时", 
};

app.post("/checkAccounts", async (req, res) => {
    try {
        const accounts = await getAccounts();
        const users = Object.keys(accounts); 

        if (users.length === 0) {
            return res.json({ status: "success", results: {} });
        }

        let results = {};
        const promises = users.map(async (username) => {
            const apiUrl = `https://${username}.serv00.net`;

            try {
                const response = await axios.get(apiUrl, { 
                    maxRedirects: 0, 
                    timeout: 5000 
                });
                const status = response.status;
                const message = statusMessages[status] || "未知状态"; 
                results[username] = {
                    status: message,
                    season: accounts[username]?.season || "--"
                };
            } catch (error) {
                let status = "检测失败";

                if (error.response) {
                    status = error.response.status;
                } else if (error.code === 'ECONNABORTED') {
                    status = "请求超时";
                }

                results[username] = {
                    status: statusMessages[status] || "未知状态",
                    season: accounts[username]?.season || "--"
                };
            }
        });

        await Promise.all(promises);

        let orderedResults = {};
        users.forEach(user => {
            orderedResults[user] = results[user];
        });

        res.json({ status: "success", results: orderedResults });

    } catch (error) {
        console.error("批量账号检测错误:", error);
        res.status(500).json({ status: "error", message: "检测失败，请稍后再试" });
    }
});

// 获取通知设置
app.get("/getNotificationSettings", (req, res) => {
    res.json(getNotificationSettings());
});

// 设置通知参数
app.post("/setNotificationSettings", (req, res) => {
    const { telegramToken, telegramChatId, cronEnabled, cronExpression } = req.body;

    if (!telegramToken || !telegramChatId) {
        return res.status(400).json({ message: "Token 和 Chat ID 不能为空" });
    }

    if (cronEnabled && (!cronExpression || !cron.validate(cronExpression))) {
        return res.status(400).json({ message: "无效的 Cron 表达式" });
    }

    const settings = { telegramToken, telegramChatId, cronEnabled, cronExpression };
    saveNotificationSettings(settings);

    resetCronJob();

    res.json({ message: "✅ 设置已保存并生效" });
});

// 服务器启动时初始化任务
resetCronJob();

app.get("/notificationSettings", isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "notification_settings.html"));
});

app.get("/catlog-data", isAuthenticated, (req, res) => {
    const errorLogFilePath = path.join(process.env.HOME, "domains", `${MAIN_SERVER_USER}.serv00.net`, "logs", "error.log");

    fs.readFile(errorLogFilePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading log file.');
        }
        res.send(data);
    });
});

app.post("/clear-log", isAuthenticated, (req, res) => {
    const errorLogFilePath = path.join(process.env.HOME, "domains", `${MAIN_SERVER_USER}.serv00.net`, "logs", "error.log");

    fs.writeFile(errorLogFilePath, '', (err) => {
        if (err) {
            return res.status(500).send('日志清理失败');
        }
        res.send('日志清理完成');
    });
});

app.get("/catlog", isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "protected", "logs.html"));
});

app.get('/ota/update', isAuthenticated, async (req, res) => {
    console.log("🚀 开始 OTA 更新...");

    const { keepAlive } = req.query;
    let keepAliveOutput = '';

    if (keepAlive === 'true') {
        try {
            const accounts = await getAccounts();
            const users = Object.keys(accounts);

            console.log(`🔄 检测到 ${users.length} 个账号，开始保活端更新...`);

            for (const user of users) {
                try {
                    const keepAliveUrl = `https://${user}.serv00.net/ota/update`;
                    console.log(`🔄 访问: ${keepAliveUrl}`);

                    const response = await axios.get(keepAliveUrl, { timeout: 20000 });
                    const output = response.data.output || '未返回内容';

                    keepAliveOutput += `👤 ${user}，更新结果: \n${output}\n`;
                    console.log(`✅ 账号 ${user} 保活端更新完成`);
                } catch (error) {
                    keepAliveOutput += `👤 ${user}，更新失败: \n${error.message}\n`;
                    console.error(`❌ 账号 ${user} 保活端更新失败: ${error.message}`);
                }
            }
        } catch (error) {
            console.error(`❌ 获取账号列表失败: ${error.message}`);
            return res.status(500).json({ success: false, message: `获取账号列表失败: ${error.message}` });
        }
    }

    const downloadScriptCommand = 'curl -Ls -o /tmp/ota.sh https://raw.githubusercontent.com/ryty1/serv00-save-me/refs/heads/main/server/ota.sh';

    exec(downloadScriptCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ 下载失败: ${error.message}`);
            return res.status(500).json({ success: false, message: `下载失败: ${error.message}` });
        }

        console.log("✅ 下载完成");
        const executeScriptCommand = 'bash /tmp/ota.sh';

        exec(executeScriptCommand, (error, stdout, stderr) => {
            exec('rm -f /tmp/ota.sh', () => console.log('✅ 清理完成'));

            if (error) {
                console.error(`❌ 执行失败: ${error.message}`);
                return res.status(500).json({ success: false, message: `执行失败: ${error.message}` });
            }

            console.log("✅ OTA 更新完成");

            // 组合最终输出内容，保持原格式，仅在前面追加保活端日志
            const finalOutput = keepAliveOutput + (stdout || '执行成功');

            res.json({ success: true, output: finalOutput });
        });
    });
});

app.get('/ota', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "protected", "ota.html"));
});

cron.schedule("0 */12 * * *", () => {
    const logFile = path.join(process.env.HOME, "domains", `${username}.serv00.net`, "logs", "error.log");
    if (fs.existsSync(logFile)) {
        fs.truncateSync(logFile, 0);  // 清空文件内容
        console.log("✅ 日志文件已清空:", new Date().toLocaleString());
    }
});

server.listen(PORT, () => {
    console.log(`🚀 服务己启动，监听端口: ${PORT}`);
});
