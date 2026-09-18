const { chromium } = require('playwright');
const path = require('path');
async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', msg => console.log('Browser log:', msg.text()));
  
  await page.goto('http://localhost:8004/index.html');
  const fileInput = await page.$('#fileInput');
  await fileInput.setInputFiles(path.resolve('employment_offer.pdf'));
  
  try {
    await page.waitForSelector('#intakeScreen.active', { timeout: 30000 });
    console.log('Doc Type:', await page.textContent('#detectedType'));
    const chips = await page.$$('.chip');
    for (const c of chips) await c.click();
    await page.fill('#extraConcern', 'What happens to my stock options if I resign?');
    await page.click('#toIntakeAnalyze');
    
    await page.waitForSelector('#analysisScreen.active', { timeout: 10000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('analysisStatus');
      return el && (el.textContent === '' || el.textContent.includes('failed'));
    }, { timeout: 60000 });
    
    const statusText = await page.textContent('#analysisStatus');
    if (statusText.includes('failed')) {
      console.log('ANALYSIS FAILED:', statusText);
    } else {
      const findings = await page.$$('.finding-card');
      for (const f of findings) {
        const topic = await (await f.$('.finding-topic'))?.textContent() || '';
        const exp = await (await f.$('.finding-explanation'))?.textContent() || '';
        const quoteEl = await f.$('.finding-quote');
        const quote = quoteEl ? await quoteEl.textContent() : null;
        if (exp.includes('Checking the document')) continue;
        console.log('Topic:', topic.trim().replace(/\n/g, '').replace(/\s+/g, ' '));
        console.log('Explanation:', exp.trim());
        if (quote) {
            console.log('Quote:', quote.trim());
            const unverifiedEl = await f.$('.unverified-note');
            console.log('Verified:', !unverifiedEl);
        } else {
            console.log('Found: false');
        }
        console.log('---');
      }
      
      await page.fill('#askInput', 'What happens to my stock options if I resign?');
      await page.click('#askBtn');
      await page.waitForFunction(() => {
        const exp = document.querySelector('#askAnswers .finding-card .finding-explanation');
        return exp && !exp.textContent.includes('Checking the document');
      }, { timeout: 60000 });
      
      const firstAnswer = (await page.$$('#askAnswers .finding-card'))[0];
      const aTopic = await (await firstAnswer.$('.finding-topic')).textContent();
      const aExp = await (await firstAnswer.$('.finding-explanation')).textContent();
      const aQuoteEl = await firstAnswer.$('.finding-quote');
      const aQuote = aQuoteEl ? await aQuoteEl.textContent() : null;
      console.log('Ask Topic:', aTopic.trim());
      console.log('Ask Exp:', aExp.trim());
      if (aQuote) console.log('Ask Quote:', aQuote.trim());
      else console.log('Ask Found: false');
    }
  } catch (e) {
    console.log('Test Error:', e.message);
  }
  await browser.close();
}
run();
