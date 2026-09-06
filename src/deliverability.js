import dns from 'dns/promises';

async function txt(name) {
  try {
    const rows = await dns.resolveTxt(name);
    return rows.map(parts => parts.join(''));
  } catch {
    return [];
  }
}

async function mx(name) {
  try { return await dns.resolveMx(name); }
  catch { return []; }
}

export async function checkDeliverability(domain) {
  const clean = String(domain || '').trim().toLowerCase();
  if (!clean || !clean.includes('.')) throw new Error('valid sender domain required');

  const [rootTxt, dmarcTxt, mxRows, googleDkim] = await Promise.all([
    txt(clean),
    txt(`_dmarc.${clean}`),
    mx(clean),
    txt(`google._domainkey.${clean}`)
  ]);

  const spf = rootTxt.find(v => /^v=spf1\b/i.test(v)) || null;
  const dmarc = dmarcTxt.find(v => /^v=dmarc1\b/i.test(v)) || null;
  const dkimGoogle = googleDkim.find(v => /^v=dkim1\b/i.test(v)) || googleDkim[0] || null;

  const warnings = [];
  if (!mxRows.length) warnings.push('No MX records detected for sender domain.');
  if (!spf) warnings.push('No SPF record detected.');
  if (!dmarc) warnings.push('No DMARC record detected.');
  if (!dkimGoogle) warnings.push('Google DKIM selector was not detected; DKIM may use a different selector, so this is not proof DKIM is absent.');

  return {
    domain: clean,
    checkedAt: new Date().toISOString(),
    mx: { ok: mxRows.length > 0, count: mxRows.length, exchanges: mxRows.map(x => x.exchange) },
    spf: { ok: Boolean(spf), record: spf },
    dmarc: { ok: Boolean(dmarc), record: dmarc },
    dkimGoogleSelector: { detected: Boolean(dkimGoogle), record: dkimGoogle },
    coreReady: Boolean(mxRows.length && spf && dmarc),
    warnings
  };
}
