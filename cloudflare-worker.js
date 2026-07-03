/**
 * Cloudflare Worker — 텔레그램 웹훅 프록시 (AI사무장봇)
 *
 * 목적: GAS 웹앱(/exec)은 POST에 302를 반환 → 텔레그램이 "실패"로 보고 재시도 →
 *       큐 적체 → 연속/동시 명령이 밀리는 문제. 이 Worker를 앞에 두면 텔레그램엔
 *       즉시 200을 주고, 업데이트는 GAS로 그대로 넘겨 처리한다(302는 Worker가 흡수).
 *
 * 사용법:
 *  1) Cloudflare 대시보드 → Workers & Pages → Create Worker → 이 코드 붙여넣기 → Deploy
 *  2) 배포된 Worker URL(...workers.dev)을 텔레그램 setWebhook 에 등록
 */
export default {
  async fetch(request, env, ctx) {
    // 봇 GAS 웹앱 /exec URL (실제 웹훅 대상)
    const GAS_URL = "https://script.google.com/a/farmboss79.com/macros/s/AKfycbyN9yC2on-F2iyvS3nl_OP8ZzwEkCOzBXTBGR2G88-CH_RXqDIgp-SvmlaT8Loi4wHrdg/exec";

    if (request.method === "POST") {
      const body = await request.text();
      // GAS로 전달(백그라운드) — 텔레그램에는 곧바로 200 반환하여 재시도/적체를 없앤다.
      ctx.waitUntil(
        fetch(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
        }).catch(() => {})
      );
      return new Response("ok", { status: 200 });
    }
    return new Response("AI사무장봇 프록시 작동 중", { status: 200 });
  },
};
