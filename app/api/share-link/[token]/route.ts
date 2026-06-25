import {
  getShareLinkByToken,
  linkAvailability,
  logShareEvent,
} from "@/modules/files/share-link-access"
import {
  isLocked,
  lockoutMinutesRemaining,
  attemptsRemaining,
} from "@/modules/files/share-link-core"

export const dynamic = "force-dynamic"

/**
 * Public share-link landing page (Commit 3). No session — the unguessable token
 * is the key. Renders: an unavailable notice, a passcode form (with live
 * lockout countdown + attempts remaining), or a direct download button.
 * Plain-English, photography-business language.
 */
function page(title: string, bodyHtml: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f5;color:#171717;margin:0;padding:0}
  .wrap{max-width:440px;margin:8vh auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:28px}
  h1{font-size:18px;margin:0 0 12px}
  p{font-size:14px;line-height:1.5;color:#404040}
  input[type=text]{width:100%;font-size:18px;letter-spacing:4px;text-align:center;padding:10px;border:1px solid #d4d4d4;border-radius:8px;margin:8px 0;box-sizing:border-box}
  button{width:100%;background:#171717;color:#fff;border:0;border-radius:8px;padding:11px;font-size:15px;cursor:pointer}
  .muted{color:#737373;font-size:12px}
  .err{color:#b91c1c;font-size:13px}
  a.btn{display:block;text-align:center;background:#171717;color:#fff;text-decoration:none;border-radius:8px;padding:11px;font-size:15px}
</style></head><body><div class="wrap">${bodyHtml}</div></body></html>`
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const row = await getShareLinkByToken(token)
  const now = new Date()
  const availability = linkAvailability(row?.link ?? null, now)

  if (!row || availability !== "ok") {
    const msg =
      availability === "expired"
        ? "This download link has expired. Please ask your photographer to reactivate it."
        : availability === "revoked"
          ? "This download link is no longer active."
          : "This download link could not be found."
    return page("Download unavailable", `<h1>Download unavailable</h1><p>${msg}</p>`)
  }

  const { link, file } = row
  await logShareEvent(link.id, link.organizationId, "opened")

  // No passcode → straight to download.
  if (!link.passcodeHash) {
    return page(
      "Your file is ready",
      `<h1>Your file is ready</h1><p>${escapeHtml(file.pathname)}</p>
       <a class="btn" href="/api/share-link/${encodeURIComponent(token)}/download">Download</a>`,
    )
  }

  // Locked out → countdown, no form.
  if (isLocked(link.lockedUntil, now)) {
    const mins = lockoutMinutesRemaining(link.lockedUntil, now)
    const until = link.lockedUntil ? link.lockedUntil.getTime() : now.getTime()
    return page(
      "Too many attempts",
      `<h1>Enter your passcode</h1>
       <p class="err">Too many incorrect attempts. Try again in <span id="cd">${String(mins)}</span> minute${mins === 1 ? "" : "s"}.</p>
       <script>(function(){var u=${String(until)};function t(){var m=Math.max(0,Math.ceil((u-Date.now())/60000));var e=document.getElementById('cd');if(e)e.textContent=m;if(m<=0)location.reload();}t();setInterval(t,1000);})();</script>`,
    )
  }

  const remaining = attemptsRemaining(link.failedPasscodeAttempts)
  const wrong = new URL(request.url).searchParams.get("wrong") === "1"
  return page(
    "Enter your passcode",
    `<h1>Enter your passcode</h1>
     <p>This file is protected. Enter the 6-digit passcode your photographer sent you.</p>
     ${wrong ? `<p class="err">That passcode wasn't right. ${String(remaining)} attempt${remaining === 1 ? "" : "s"} remaining.</p>` : `<p class="muted">${String(remaining)} attempts remaining.</p>`}
     <form method="post" action="/api/share-link/${encodeURIComponent(token)}/verify">
       <input type="text" name="passcode" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="000000" required />
       <button type="submit">View file</button>
     </form>`,
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
