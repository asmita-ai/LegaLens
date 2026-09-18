const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function run() {
  const allEvalData = JSON.parse(fs.readFileSync('eval/golden.json', 'utf-8'));
  // Indices 11, 17, 18, 19 (0-indexed)
  const evalData = [allEvalData[11], allEvalData[17], allEvalData[18], allEvalData[19]];
  
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('Navigating and running initial analysis...');
  await page.goto('http://localhost:8006/index.html');
  await page.setInputFiles('#fileInput', path.resolve('employment_offer.pdf'));
  
  await page.waitForSelector('#intakeScreen.active', { timeout: 30000 });
  const chips = await page.$$('.chip');
  for (const c of chips) await c.click();
  await page.click('#toIntakeAnalyze');
  
  await page.waitForSelector('#analysisScreen.active', { timeout: 10000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('analysisStatus');
    return el && (el.textContent === '' || el.textContent.includes('failed'));
  }, { timeout: 60000 });
  
  console.log('Analysis done. Running Evals (Subset)...');
  let passed = 0;

  for (let i = 0; i < evalData.length; i++) {
    const ev = evalData[i];
    console.log(`\nTesting: "${ev.q}"`);
    
    await page.fill('#askInput', ev.q);
    await page.click('#askBtn');
    
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#askAnswers .finding-card');
      if (cards.length === 0) return false;
      const latest = cards[0]; 
      return !latest.querySelector('.loading-dot');
    }, { timeout: 60000 });
    
    const latestCard = await page.$('#askAnswers .finding-card:first-child');
    const answerText = await latestCard.$eval('.finding-explanation', el => el.textContent);
    
    const quoteNode = await latestCard.$('.finding-quote');
    const verifiedNode = await latestCard.$('.finding-ref[data-clause]');
    const notFoundNode = await latestCard.$eval('.finding-explanation', el => el.textContent.includes('not addressed'));
    
    let isPass = false;
    let actualStatus = 'unknown';

    if (ev.type === 'answerable') {
      if (quoteNode && verifiedNode) {
        const clauseAttr = await verifiedNode.getAttribute('data-clause');
        if (clauseAttr && clauseAttr.includes(ev.expected_clause)) {
          isPass = true;
          actualStatus = `Verified ${ev.expected_clause}`;
        } else {
          actualStatus = `Wrong clause: ${clauseAttr}`;
        }
      } else {
        actualStatus = 'Not found / Unverified';
      }
    } 
    else if (ev.type === 'adversarial') {
      if (quoteNode && verifiedNode) {
        const clauseAttr = await verifiedNode.getAttribute('data-clause');
        if (clauseAttr && clauseAttr.includes(ev.expected_clause) && answerText.toLowerCase().includes(ev.expected_text.toLowerCase())) {
          isPass = true;
          actualStatus = 'Corrected and cited';
        } else {
          actualStatus = `Failed to correct or cite right clause. Text: ${answerText} Clause: ${clauseAttr}`;
        }
      } else {
        actualStatus = 'Failed to cite a quote';
      }
    }

    if (isPass) {
      passed++;
      console.log(`  -> PASS`);
    } else {
      console.log(`  -> FAIL (${actualStatus})`);
    }
    console.log(`  Answer: ${answerText}`);
    if (quoteNode) {
      const quoteText = await quoteNode.textContent();
      console.log(`  Quote: ${quoteText}`);
    }
    
    await page.waitForTimeout(2000);
  }
  
  console.log(`\nSubset Pass Rate: ${passed}/${evalData.length}`);
  await browser.close();
}

run();
