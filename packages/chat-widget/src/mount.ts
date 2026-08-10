const STYLE_ID = "statewave-chat-widget-styles";

export interface Citation {
  evidenceId: string;
  subject: string;
  sourceId: string;
  label: string;
  snippet: string;
}

export interface ChatTurnResponse {
  answer: string;
  grounded: boolean;
  citations?: Citation[];
  warnings?: string[];
  evidenceCount?: number;
}

export interface MountOptions {
  apiUrl: string;
  readSubjects: string[];
  retrievalConfig?: { globalMaxTokens?: number };
  title?: string;
  placeholder?: string;
  mode?: "shopper" | "ops";
  onResolveGap?: (sourceId: string) => unknown;
  authToken?: string;
}

export interface MountedChat {
  sessionId: string;
  send: (text: string) => Promise<void>;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  .sw-chat { display:flex; flex-direction:column; height:100%; min-height:420px;
    border:1px solid var(--sw-line,#d3dad6); border-radius:14px; background:var(--sw-paper,#f7f8f6);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; overflow:hidden; }
  .sw-chat__head { display:flex; align-items:center; gap:.5rem; padding:.7rem 1rem;
    background:var(--sw-ground,#0b1a1a); color:#dbe7e3; font-size:.78rem; letter-spacing:.04em; }
  .sw-chat__dot { width:7px; height:7px; border-radius:50%; background:var(--sw-teal,#0f9b8e); }
  .sw-chat__body { flex:1; overflow-y:auto; padding:1rem; display:flex; flex-direction:column; gap:.6rem; }
  .sw-bubble { max-width:88%; padding:.6rem .8rem; border-radius:11px; font-size:.9rem; line-height:1.45; }
  .sw-bubble--user { align-self:flex-end; background:#26413d; color:#eaf3f0; border-bottom-right-radius:3px; }
  .sw-bubble--bot { align-self:flex-start; background:#fff; color:#16302c; border:1px solid var(--sw-line,#d3dad6);
    border-bottom-left-radius:3px; }
  .sw-cites { display:flex; flex-wrap:wrap; gap:.35rem; margin-top:.5rem; }
  .sw-cite { font-family:ui-monospace,monospace; font-size:.66rem; background:#f3e6cf; color:#7a4e0c;
    border:1px solid #e3cfa5; padding:.14rem .45rem; border-radius:5px; }
  .sw-note { font-family:ui-monospace,monospace; font-size:.66rem; color:#9a5b57; margin-top:.4rem; }
  .sw-resolve { margin-top:.5rem; font-size:.72rem; background:#0f9b8e; color:#fff; border:none;
    padding:.3rem .6rem; border-radius:6px; cursor:pointer; }
  .sw-resolve:hover { background:#0a6b62; }
  .sw-chat__form { display:flex; gap:.5rem; padding:.75rem; border-top:1px solid var(--sw-line,#d3dad6); background:#fff; }
  .sw-chat__input { flex:1; border:1px solid var(--sw-line,#d3dad6); border-radius:9px; padding:.55rem .7rem; font-size:.88rem; }
  .sw-chat__send { background:var(--sw-teal,#0f9b8e); color:#fff; border:none; border-radius:9px;
    padding:.55rem 1rem; font-size:.88rem; cursor:pointer; }
  .sw-chat__send:disabled { opacity:.5; cursor:default; }
  .sw-typing { font-size:.78rem; color:#6a807b; font-style:italic; }
  `;
  document.head.appendChild(style);
}

interface BubbleOptions {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  grounded?: boolean;
  note?: string;
}

function bubble({ role, text, citations = [], grounded, note }: BubbleOptions): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = `sw-bubble sw-bubble--${role === "user" ? "user" : "bot"}`;
  wrap.textContent = text;

  if (role !== "user" && citations.length) {
    const cites = document.createElement("div");
    cites.className = "sw-cites";
    for (const c of citations) {
      const chip = document.createElement("span");
      chip.className = "sw-cite";
      chip.textContent = `↳ ${c.subject.split(":")[0]} · ${c.label}`;
      cites.appendChild(chip);
    }
    wrap.appendChild(cites);
  }
  if (role !== "user" && grounded === false) {
    const n = document.createElement("div");
    n.className = "sw-note";
    n.textContent = "no evidence → no claim";
    wrap.appendChild(n);
  }
  if (note) {
    const n = document.createElement("div");
    n.className = "sw-note";
    n.style.color = "#0a6b62";
    n.textContent = note;
    wrap.appendChild(n);
  }
  return wrap;
}

/**
 * mountStatewaveChat(el, options) — the storefront-facing drop-in.
 * Mirrors @statewavedev/chat-widget's mountStatewaveChat(): the browser only
 * ever talks to your own proxy route (options.apiUrl), never to an LLM or to
 * Statewave directly.
 */
export function mountStatewaveChat(el: HTMLElement, options: MountOptions): MountedChat {
  const {
    apiUrl,
    readSubjects,
    retrievalConfig = { globalMaxTokens: 2000 },
    title = "Ask us anything",
    placeholder = "Type a question…",
    mode = "shopper",
    onResolveGap,
    authToken,
  } = options;

  injectStyles();
  const sessionId = `sess_${Math.random().toString(36).slice(2)}`;

  el.innerHTML = "";
  const root = document.createElement("div");
  root.className = "sw-chat";

  const head = document.createElement("div");
  head.className = "sw-chat__head";
  head.innerHTML = `<span class="sw-chat__dot"></span> ${title}`;

  const body = document.createElement("div");
  body.className = "sw-chat__body";

  const form = document.createElement("form");
  form.className = "sw-chat__form";
  form.innerHTML = `
    <input class="sw-chat__input" type="text" placeholder="${placeholder}" autocomplete="off" />
    <button class="sw-chat__send" type="submit">Send</button>
  `;

  root.append(head, body, form);
  el.appendChild(root);

  const input = form.querySelector(".sw-chat__input") as HTMLInputElement;
  const sendBtn = form.querySelector(".sw-chat__send") as HTMLButtonElement;

  async function send(text: string): Promise<void> {
    body.appendChild(bubble({ role: "user", text }));
    body.scrollTop = body.scrollHeight;

    const typing = document.createElement("div");
    typing.className = "sw-typing";
    typing.textContent = "thinking…";
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;

    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ sessionId, message: text, readSubjects, retrievalConfig }),
      });
      const data: ChatTurnResponse = await res.json();
      typing.remove();

      const botBubble = bubble({
        role: "assistant",
        text: data.answer,
        citations: data.citations,
        grounded: data.grounded,
      });
      body.appendChild(botBubble);

      if (mode === "ops") {
        const gapCitation = (data.citations || []).find((c) => c.subject === "ops:coverage-gaps");
        if (gapCitation) {
          const btn = document.createElement("button");
          btn.className = "sw-resolve";
          btn.textContent = "Mark this gap resolved";
          btn.onclick = async () => {
            btn.disabled = true;
            btn.textContent = "Resolving…";
            await (onResolveGap ? onResolveGap(gapCitation.sourceId) : Promise.resolve());
            btn.textContent = "Resolved ✓";
          };
          botBubble.appendChild(btn);
        }
      }
    } catch {
      typing.remove();
      body.appendChild(
        bubble({ role: "assistant", text: "Something went wrong reaching the assistant.", grounded: false })
      );
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      body.scrollTop = body.scrollHeight;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) send(text);
  });

  return { sessionId, send };
}
