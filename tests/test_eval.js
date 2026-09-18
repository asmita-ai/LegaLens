const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function run() {
  const evalData = JSON.parse(fs.readFileSync('eval/golden.json', 'utf-8'));
  
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
  
  const aStatus = await page.textContent('#analysisStatus');
  if (aStatus.includes('failed')) {
    console.log('Analysis failed, aborting eval.');
    await browser.close();
    return;
  }
  
  console.log('Analysis done. Running Evals...');
  let passed = 0;
  const failures = [];

  for (let i = 0; i < evalData.length; i++) {
    const ev = evalData[i];
    console.log(`[${i+1}/${evalData.length}] Testing: "${ev.q}"`);
    
    await page.fill('#askInput', ev.q);
    await page.click('#askBtn');
    
    // Wait for the specific answer card to finish loading (loading-dot class goes away)
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#askAnswers .finding-card');
      if (cards.length === 0) return false;
      const latest = cards[0]; // prepend means it's the first one
      return !latest.querySelector('.loading-dot');
    }, { timeout: 60000 });
    
    const latestCard = await page.$('#askAnswers .finding-card:first-child');
    const answerText = await latestCard.$eval('.finding-explanation', el => el.textContent);
    
    // Check if it verified a quote (if found=true)
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
    else if (ev.type === 'abstention') {
      if (!quoteNode && notFoundNode) {
        isPass = true;
        actualStatus = 'Properly abstained';
      } else {
        actualStatus = quoteNode ? 'Hallucinated a quote' : 'Answered without quote';
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
      failures.push({
        q: ev.q,
        type: ev.type,
        expected: ev.expected_clause || 'abstention',
        actual: actualStatus,
        answer: answerText
      });
    }
    
    // Wait a couple seconds to be polite to the rate limit
    await page.waitForTimeout(2000);
  }
  
  const passRate = (passed / evalData.length * 100).toFixed(1);
  console.log(`\n--- EVAL RESULTS ---`);
  console.log(`Pass Rate: ${passed}/${evalData.length} (${passRate}%)`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f, i) => {
      console.log(`${i+1}. Q: "${f.q}"`);
      console.log(`   Type: ${f.type}`);
      console.log(`   Expected: ${f.expected}`);
      console.log(`   Actual Status: ${f.actual}`);
      console.log(`   Model Answer: ${f.answer}\n`);
    });
  }

  await browser.close();
}

run();
