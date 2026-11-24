/**
 * The Report dialog of the public pages (a video's page, a profile): a <dialog> with the reasons and
 * a note, posting to /api/reports. `kind` and `target` say what is reported; a comment's Report
 * button calls window.kavoxReport('comment', id) itself.
 */
export function reportDialog(kind: 'video' | 'profile', target: string): string {
  return `<dialog id="report" style="max-width:420px;width:calc(100% - 32px);border:1px solid #334155;border-radius:14px;background:#0f172a;color:#e2e8f0;padding:18px">
  <form method="dialog" id="report-form">
    <h3 style="margin:0 0 10px;color:#fff;font-size:17px" id="report-title">Report</h3>
    ${[
      ['copyright', 'It uses my work (copyright)'],
      ['abuse', 'Harassment, threats or hate'],
      ['sexual', 'Sexual content'],
      ['violence', 'Violence or dangerous acts'],
      ['spam', 'Spam, scam or impersonation'],
      ['other', 'Something else'],
    ]
      .map(([v, label], i) => `<label style="display:block;padding:4px 0"><input type="radio" name="reason" value="${v}"${i === 0 ? ' required' : ''}> ${label}</label>`)
      .join('')}
    <textarea name="details" rows="3" maxlength="1000" placeholder="Details (optional; for copyright: what you own and how to reach you)" style="width:100%;margin-top:8px;box-sizing:border-box;background:#020617;color:#fff;border:1px solid #334155;border-radius:8px;padding:8px;font:inherit"></textarea>
    <p id="report-note" style="font-size:13px;color:#94a3b8;margin:8px 0 0"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button value="cancel" class="btn" type="submit" formnovalidate>Cancel</button>
      <button value="send" class="btn primary" type="submit">Send report</button>
    </div>
  </form>
</dialog>
<script>
  (() => {
    const dlg = document.getElementById('report');
    const form = document.getElementById('report-form');
    let what = { kind: ${JSON.stringify(kind)}, target: ${JSON.stringify(target)} };
    window.kavoxReport = (kind, target) => {
      what = { kind, target: String(target) };
      form.reset();
      document.getElementById('report-title').textContent = kind === 'comment' ? 'Report this comment' : kind === 'profile' ? 'Report this profile' : 'Report this video';
      document.getElementById('report-note').textContent = '';
      dlg.showModal();
    };
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue !== 'send') return;
      const data = new FormData(form);
      const res = await fetch('/api/reports', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...what, reason: data.get('reason'), details: data.get('details') }),
      }).catch(() => null);
      alert(res && res.ok ? 'Thank you. The report was sent and will be reviewed.' : 'The report could not be sent. Try again later.');
    });
  })();
</script>`;
}
