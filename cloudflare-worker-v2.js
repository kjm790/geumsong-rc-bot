/**
 * Cloudflare Worker v2 — 텔레그램 웹훅 프록시 (클럽마다 Worker 1개)
 *
 * 하는 일
 *  1) 텔레그램에는 즉시 200 을 돌려준다 → GAS 웹앱의 302 응답 때문에 생기는 재시도·적체(봇 멈춤)를 없앤다.
 *  2) 텔레그램이 보낸 비밀 헤더(X-Telegram-Bot-Api-Secret-Token)를 검증한다 → 주소를 아는 제3자의 가짜 명령 차단.
 *  3) 검증된 업데이트만 GAS 로 넘기며 ?k=비밀값 을 붙인다 → GAS 도 Worker 를 거친 요청만 처리.
 *
 * 코드에는 주소·비밀값을 쓰지 않는다. Worker 의 Settings → Variables and Secrets 에 아래 2개를 넣는다.
 *   GAS_URL   : GAS 웹앱 /exec 주소            (Type: Secret)
 *   TG_SECRET : GAS genWebhookSecret 이 만든 값 (Type: Secret)
 */
export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("AI사무장 프록시 작동 중", { status: 200 });
    if (!env.GAS_URL || !env.TG_SECRET) return new Response("not configured", { status: 500 });

    // 비밀 헤더가 틀리면 조용히 200(재시도 유발 방지)만 주고 버린다.
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TG_SECRET) {
      return new Response("ok", { status: 200 });
    }
    const body = await request.text();
    const url = env.GAS_URL + (env.GAS_URL.includes("?") ? "&" : "?") + "k=" + encodeURIComponent(env.TG_SECRET);
    ctx.waitUntil(
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {})
    );
    return new Response("ok", { status: 200 });
  },
};
