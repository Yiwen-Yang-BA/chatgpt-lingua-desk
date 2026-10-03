import {
  $,
  escape,
  load,
  save,
  toast,
  download,
  copy,
  init,
  run,
  busy,
  resultMeta,
  fileText,
} from "./ui.js";
let result = null;
let pending = false;
let importing = false;
const fields = ["text", "source", "target", "tone", "format", "glossary"];
const draft = load("lingua-desk-v1", {});
for (const f of fields)
  if (typeof draft[f] === "string") $("#" + f).value = draft[f];
function sample(srt = false) {
  $("#format").value = srt ? "srt" : "text";
  $("#source").value = "English";
  $("#target").value = "简体中文";
  $("#text").value = srt
    ? "1\n00:00:01,000 --> 00:00:03,500\nWelcome to your workspace.\n\n2\n00:00:04,000 --> 00:00:06,000\nYour privacy matters."
    : "Welcome to your workspace.\n\nYour privacy matters.";
  $("#glossary").value = "workspace = 工作区\nprivacy = 隐私";
}
$("#sample").onclick = () => sample();
$("#srt-sample").onclick = () => sample(true);
$("#save-draft").onclick = () => {
  if (
    save(
      "lingua-desk-v1",
      Object.fromEntries(fields.map((f) => [f, $("#" + f).value])),
    )
  )
    toast("草稿和术语表已保存");
};
$("#file").onchange = async (e) => {
  if (pending || importing) {
    e.target.value = "";
    return;
  }
  importing = true;
  [
    ...fields,
    "mode",
    "sample",
    "srt-sample",
    "file",
    "translate",
    "save-draft",
  ].forEach((f) => ($("#" + f).disabled = true));
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (!/\.(txt|srt)$/i.test(f.name)) throw Error("只支持 TXT 和 SRT");
    const t = await fileText(f, 60000);
    if (t.length > 15000) throw Error("最多 15000 字符");
    $("#text").value = t;
    $("#format").value = f.name.toLowerCase().endsWith(".srt") ? "srt" : "text";
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.value = "";
    importing = false;
    [
      ...fields,
      "mode",
      "sample",
      "srt-sample",
      "file",
      "translate",
      "save-draft",
    ].forEach((f) => ($("#" + f).disabled = false));
  }
};
$("#translate-form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending || importing) return;
  pending = true;
  $("#translation").readOnly = true;
  busy($("#translate"), true, "正在逐段翻译…");
  [...fields, "mode", "sample", "srt-sample", "file"].forEach(
    (f) => ($("#" + f).disabled = true),
  );
  try {
    const payload = Object.fromEntries(
      fields.map((f) => [f, $("#" + f).value]),
    );
    const r = await run(payload);
    result = { ...r.data, source: payload.text, mode: r.meta.mode };
    $("#translation").value = result.translation;
    $("#warnings").innerHTML = result.warnings
      .map((w) => "• " + escape(w))
      .join("<br>");
    $("#meta").innerHTML = resultMeta(r.meta);
    $("#empty").hidden = true;
    $("#output").hidden = false;
    $("#segment-count").textContent = `${result.segments.length} 个片段`;
    $("#segments").innerHTML = result.segments
      .map(
        (s, i) =>
          `<article class="card"><span class="pill">${i + 1}</span><div class="grid2"><p class="segment-text">${escape(s.source)}</p><p class="segment-text">${escape(s.translation)}</p></div></article>`,
      )
      .join("");
  } catch (err) {
    toast(err.message, true);
  } finally {
    pending = false;
    $("#translation").readOnly = false;
    busy($("#translate"), false);
    [...fields, "mode", "sample", "srt-sample", "file"].forEach(
      (f) => ($("#" + f).disabled = false),
    );
  }
};
$("#download").onclick = () => {
  if (result)
    download(
      `translation.${result.format === "srt" ? "srt" : "txt"}`,
      $("#translation").value,
    );
};
$("#copy").onclick = () => copy($("#translation").value);
$("#bilingual").onclick = () => {
  if (result)
    download(
      "bilingual.md",
      `# 双语对照\n\n模式：${result.mode}\n\n` +
        result.segments
          .map((s, i) => `## ${i + 1}\n\n${s.source}\n\n${s.translation}`)
          .join("\n\n"),
    );
};
await init();
