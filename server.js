const http = require("http");
const crypto = require("crypto");

// Хранилище челленджей в памяти (в продакшене используйте Redis или БД)
// Структура: challengeId -> { email, code, expiresAt, purpose, name }
const challenges = new Map();
// Общие CORS-заголовки
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Вспомогательная функция для чтении JSON-тела запроса
function getRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", chunk => {
            body += chunk.toString();
        });
        request.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        request.on("error", reject);
    });
}

// Вспомогательная функция отправки JSON-ответа
function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders // Добавляем CORS к каждому ответу
    });
    response.end(JSON.stringify(data));
}

http.createServer(async function (request, response) {
    const { method, url } = request; // исправлено с req на request
    const parsedUrl = new URL(url, `http://${request.headers.host}`);
    const pathname = parsedUrl.pathname;

    // 1. Обработка Preflight (OPTIONS) запросов
    if (method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        return response.end();
    }

    if (method === "POST" && pathname.startsWith("/auth/email")) {
        try {
            const body = await getRequestBody(request);

            // 1. Запрос кода подтверждения
            if (pathname === "/auth/email/request-code") {
                const { email, name, purpose } = body;

                if (!email || !purpose) {
                    return sendJson(response, 400, {
                        message: "Параметры 'email' и 'purpose' обязательны"
                    });
                }

                // Генерируем уникальный challengeId и 6-значный код (например, 123456)
                const challengeId = crypto.randomUUID();
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                const expiresInSeconds = 300; // Код действителен 5 минут

                // Сохраняем сессию подтверждения
                challenges.set(challengeId, {
                    email,
                    code,
                    purpose,
                    name,
                    expiresAt: Date.now() + expiresInSeconds * 1000
                });

                // Вывод кода в консоль сервера (в реальном приложении — отправка на Email)
                console.log(`[AUTH CODE] Email: ${email} | Code: ${code} | ChallengeId: ${challengeId}`);

                return sendJson(response, 200, {
                    challengeId: challengeId,
                    expiresInSeconds: expiresInSeconds,
                    retryAfterSeconds: 60
                });
            }

            // 2. Проверка кода и выдача токенов
            if (pathname === "/auth/email/verify-code") {
                const { challengeId, code, email } = body;

                if (!challengeId || !code || !email) {
                    return sendJson(response, 400, {
                        message: "Параметры 'challengeId', 'code' и 'email' обязательны"
                    });
                }

                const challenge = challenges.get(challengeId);

                // Проверка существования челленджа
                if (!challenge) {
                    return sendJson(response, 400, {
                        message: "Челлендж не найден или срок его действия истек"
                    });
                }

                // Проверка совпадения email и кода
                if (challenge.email !== email || challenge.code !== code) {
                    return sendJson(response, 400, {
                        message: "Неверный код или email"
                    });
                }

                // Проверка срока годности кода
                if (Date.now() > challenge.expiresAt) {
                    challenges.delete(challengeId);
                    return sendJson(response, 400, {
                        message: "Срок действия кода истек"
                    });
                }

                // Удаляем одноразовый челлендж после успешной проверки
                challenges.delete(challengeId);

                // Генерируем тестовые токены (в продакшене используйте jsonwebtoken / JWT)
                const accessToken = "access_" + crypto.randomBytes(32).toString("hex");
                const refreshToken = "refresh_" + crypto.randomBytes(32).toString("hex");

                return sendJson(response, 200, {
                    accessToken: accessToken,
                    refreshToken: refreshToken,
                    onboardingCompleted: true
                });
            }
        } catch (err) {
            return sendJson(response, 400, { message: "Некорректный JSON в теле запроса" });
        }
    }

    // Обработка 404 для нераспределенных маршрутов
    sendJson(response, 404, { message: "Маршрут не найден" });
}).listen(3000, () => {
    console.log("Сервер авторизации запущен на http://localhost:3000");
});