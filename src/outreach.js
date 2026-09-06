import { validateOutreach } from './messageGuard.js';

function topIssues(audit) {
  const severity = { high: 3, medium: 2, low: 1 };
  return (audit.issues || []).slice().sort((a, b) => (severity[b.severity] || 0) - (severity[a.severity] || 0)).slice(0, 3).map(issue => issue.title.replace('Missing or weak: ', '').replace('Not detected publicly: ', ''));
}
function money(n) { return Number(n || 0).toLocaleString('en-US'); }
function issueSentence(issues) { if (!issues.length) return 'الفحص ما أعطاني مشكلة سطحية أقدر أعتبرها مؤكدة، لذلك ركزت فقط على النقاط القابلة للإثبات.'; if (issues.length === 1) return `أوضح نقطة ظهرت لي في الفحص العام: ${issues[0]}.`; return `أوضح النقاط اللي ظهرت لي في الفحص العام: ${issues.join('، ')}.`; }
function businessContext(lead, audit) {
  if (!lead.website) return `وصلت لـ ${lead.name} من Google، وما قدرت أتحقق من موقع رسمي مستقل ضمن المصادر العامة الحالية.`;
  const bi = audit.businessIntelligence || {};
  const cats = (bi.categories || []).slice(0, 4).join('، ');
  const parts = [`راجعت ${lead.name} والموقع بشكل فعلي`];
  if (bi.industry) parts.push(`وفهمت النشاط كـ ${bi.industry}`);
  if (bi.platform) parts.push(`والمتجر يعمل على ${bi.platform}`);
  if (cats) parts.push(`والأقسام الظاهرة تشمل ${cats}`);
  return `${parts.join('، ')}.`;
}
function buildBreakdownLines(audit, includeMoney) { return (audit.opportunityBreakdown || []).slice(0, 5).map(item => { const r = item.annualRange || {}; return includeMoney ? `• ${item.service}: ${money(r.low)}–${money(r.high)} ريال سنويًا — ${item.issues?.slice(0, 2).join('، ') || ''}` : `• ${item.service}: ${item.issues?.slice(0, 2).join('، ') || ''}`; }); }
function ensureBookingLink(body, bookingUrl) { if (!bookingUrl || String(body).includes(bookingUrl)) return body; return `${String(body).trim()}\n\nإذا حابين نشوف المراجعة سوا، هذا رابط موعد قصير:\n${bookingUrl}`; }
function withQuality(message, { audit, bookingUrl }) { const quality = validateOutreach({ subject: message.subject, body: message.body, bookingUrl, audit }); return { ...message, quality }; }

function fallbackMessage({ lead, audit, bookingUrl }) {
  const issues = topIssues(audit); const route = lead.contactRoute || { channel: lead.contactEmail ? 'email' : 'research_required', destination: lead.contactEmail || null }; const context = businessContext(lead, audit); const gapLine = issueSentence(issues); const annual = audit.opportunity?.annualRange || { low: 0, high: 0 }; const showMoney = audit.opportunity?.displayEligible === true; const breakdown = buildBreakdownLines(audit, showMoney); const confidence = audit.opportunity?.confidence; const bi = audit.businessIntelligence || {};
  const headline = showMoney && annual.high > 0
    ? `بناءً على نوع النشاط والمنتجات/الأسعار العامة اللي قدرنا نرصدها ومسار التحويل الظاهر، قد تكون عندكم فرصة تحسين تقديرية بين ${money(annual.low)} و${money(annual.high)} ريال سنويًا${confidence ? ` بدرجة ثقة ${confidence}%` : ''}.`
    : 'قدرت أفهم النشاط ومسار الشراء من الموقع، لكن مستوى الثقة التجاري الحالي ما يكفي إني أحط رقم مالي وأقدمه كأنه دقيق.';
  const modelLine = bi.averageTicketSource ? `مصدر نموذج القيمة: ${bi.averageTicketSource}${bi.priceSamples?.length ? ` من عينات أسعار عامة (${bi.priceSamples.slice(0,4).map(x=>`${money(x)} ريال`).join('، ')})` : ''}.` : '';
  const body = `مرحبًا فريق ${lead.name}\n\n${context}\n\n${gapLine}\n\n${headline}${modelLine ? `\n${modelLine}` : ''}${breakdown.length ? `\n\nالتفصيل حسب كل جزء:\n${breakdown.join('\n')}` : ''}\n\nمهم: الفحص يعتمد على بيانات عامة فقط. أي Integration ديناميكي مثل Meta Pixel أو Analytics أو روابط اجتماعية إذا ما قدرنا نثبته علنًا، ما نعتبره مفقودًا ولا نحسب عليه فرصة مالية.\n\nأنا ما أرسل لكم عرض تسويق عام. عندي المراجعة نفسها وأقدر أوريكم إيش ظهر فعليًا وإيش الأولوية التجارية بناءً على المتجر نفسه.\n\n${bookingUrl ? `إذا حابين نشوفها سوا، هذا رابط موعد قصير:\n${bookingUrl}\n\n` : ''}محمد\nSahab Agency`;
  return withQuality({ subject: showMoney && annual.high > 0 ? `${lead.name}: فرصة تحسين تقديرية حتى ${money(annual.high)} ريال سنويًا` : `${lead.name}: ملاحظات مبنية على المتجر نفسه`, body, channel: route.channel === 'research_required' ? 'email' : route.channel, destination: route.destination || lead.contactEmail || null, generatedBy: 'rules', evidenceUsed: issues, requiresReview: true }, { audit, bookingUrl });
}

async function viaOpenAI({ lead, audit, bookingUrl, industry, location }) {
  const key = process.env.OPENAI_API_KEY; if (!key) return null; const showMoney = audit.opportunity?.displayEligible === true; const bi = audit.businessIntelligence || {};
  const payload = { model: process.env.OPENAI_MODEL || 'gpt-5-mini', input: [{ role: 'system', content: `Write a concise Arabic B2B outbound email for a Saudi/Gulf business in a natural professional tone. First demonstrate that the business was actually understood from its website: business type, platform, categories/products, and public pricing signals when provided. Use only provided evidence. Dynamic integrations such as Meta Pixel, Analytics, GTM, Instagram/Facebook links can be injected client-side; if the audit marks them unknown or does not positively detect them, NEVER call them missing and NEVER infer that ads are inactive. ${showMoney ? 'A SAR opportunity range is allowed because business intelligence and commercial context passed the credibility gate. Explain it as an estimate derived from observed products/prices/platform plus bounded demand assumptions, never as verified loss.' : 'Do not mention a SAR amount because the commercial confidence gate did not pass.'} Never invent traffic, spend, rankings, revenue, ad status, customer behavior, product prices, or platform usage. No guarantees, hype, emojis, or spammy urgency. Keep subject under 90 characters if possible. If a booking URL is provided, include it exactly once near the end. Output valid JSON with subject and body only.` }, { role: 'user', content: JSON.stringify({ business: lead.name, website: lead.website, googleRating: lead.rating, reviewCount: lead.reviewCount, requestedIndustry: industry, location, inferredBusinessIntelligence: bi, auditMode: audit.auditMode, qualification: audit.qualification, contactRoute: lead.contactRoute, socials: lead.socials, auditScore: audit.score, issues: audit.issues, unknowns: audit.unknowns, evidence: audit.evidence, commercialProfile: showMoney ? audit.commercialProfile : { withheld: true }, opportunityEstimate: showMoney ? audit.opportunity : { displayEligible: false, withheldReason: audit.opportunity?.withheldReason }, opportunityBreakdown: audit.opportunityBreakdown?.map(x => ({ service: x.service, issues: x.issues, annualRange: showMoney ? x.annualRange : undefined })), bookingUrl }) }] };
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
  if (!response.ok) return null; const data = await response.json(); const text = data.output_text || data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text; if (!text) return null;
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try { const parsed = JSON.parse(cleaned); if (!parsed.subject || !parsed.body) return null; const candidate = withQuality({ subject: parsed.subject, body: ensureBookingLink(parsed.body, bookingUrl), channel: lead.contactRoute?.channel || (lead.contactEmail ? 'email' : 'research_required'), destination: lead.contactRoute?.destination || lead.contactEmail || null, generatedBy: 'openai', evidenceUsed: topIssues(audit), requiresReview: true }, { audit, bookingUrl }); return candidate.quality.ok ? candidate : null; } catch { return null; }
}

export async function buildOutreach(args) { const ai = await viaOpenAI(args).catch(() => null); if (ai) return ai; const fallback = fallbackMessage(args); return { ...fallback, qualityFallback: !ai }; }
