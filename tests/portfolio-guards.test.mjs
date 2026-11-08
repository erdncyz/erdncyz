import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const articleUrls = [
  'https://medium.com/@erdncyz/cloudflare-security-audit-skill-kodlama-ajan%C4%B1n%C4%B1-kan%C4%B1t-isteyen-bir-g%C3%BCvenlik-denet%C3%A7isine-%C3%A7evirmek-fa242e9f96e2',
  'https://medium.com/@erdncyz/colibri-ile-kendi-makinenizde-y%C3%BCz-milyarlarca-parametrelik-moe-%C3%A7al%C4%B1%C5%9Ft%C4%B1rmak-d9b5a7f6f25c',
  'https://medium.com/@erdncyz/s%C4%B1f%C4%B1rdan-de%C4%9Fil-mevcut-kod-taban%C4%B1nda-ajanla-performans-iyile%C5%9Ftirmesi-yapt%C4%B1rmak-347411942447',
  'https://medium.com/@erdncyz/vibe-coding-ile-s%C4%B1f%C4%B1rdan-proje-senior-geli%C5%9Ftirici-gibi-kurgulanm%C4%B1%C5%9F-bir-repo-i%CC%87%C3%A7in-ad%C4%B1m-ad%C4%B1m-rehber-67f590089adf',
  'https://medium.com/@erdncyz/paketi-import-etmeden-bile-%C3%A7al%C4%B1%C5%9Fan-zararl%C4%B1-litellm-olay%C4%B1-ve-geli%C5%9Ftirici-makinesindeki-ai-e6d225b782de',
  'https://medium.com/@erdncyz/agent-skills-art%C4%B1k-a%C3%A7%C4%B1k-standart-ekibin-bilgisini-skill-olarak-paketlemek-025097791952',
];

function blogSection() {
  const start = html.indexOf('id="blog"');
  const end = html.indexOf('id="contact"');
  assert.ok(start > 0 && end > start);
  return html.slice(start, end);
}

test('analytics tag is not requested until acceptance', () => {
  assert.equal(html.includes('<script async src="https://www.googletagmanager.com'), false);
  assert.equal((html.match(/www\.googletagmanager\.com/g) || []).length, 1);
  assert.equal((html.match(/google-analytics\.com/g) || []).length, 0);
  const accept = html.slice(html.indexOf('function acceptCookies'), html.indexOf('function declineCookies'));
  const decline = html.slice(html.indexOf('function declineCookies'), html.indexOf("getElementById('cookie-accept')"));
  assert.match(accept, /loadAnalytics\(\)/);
  assert.equal(decline.includes('loadAnalytics'), false);
  const branch = html.slice(html.indexOf("if (consent === 'true')"), html.indexOf('showCookieBanner();'));
  assert.match(branch, /consent === 'true'[\s\S]*loadAnalytics\(\)/);
  assert.match(branch, /consent === 'false'\) \{\s*hideCookieBanner\(\);\s*\}/);
  assert.equal(branch.includes("consent === 'false'") && branch.split("consent === 'false'")[1].includes('loadAnalytics'), false);
});

test('cookie banner stays in document flow and its actions are buttons', () => {
  assert.match(html, /id="cookieBanner" hidden class="cookie-banner"/);
  assert.equal(html.includes('fixed bottom-0'), false);
  assert.match(html, /id="cookie-accept"[\s\S]*type="button"|type="button" id="cookie-accept"/);
  assert.match(html, /<button type="button" id="cookie-accept"/);
  assert.match(html, /<button type="button" id="cookie-reject"/);
});

test('sections stay visible without JS and hash targets are not hidden', () => {
  assert.match(html, /\.reveal \{\s*opacity: 1;/);
  assert.match(html, /html\.motion-ok \.reveal \{\s*opacity: 0;/);
  assert.match(html, /html\.motion-ok :target \.reveal/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /html\.motion-ok \.reveal \{ opacity: 1 !important;/);
  assert.match(html, /revealHashTarget/);
});

test('blog cards are the six verified Medium articles', () => {
  const blog = blogSection();
  const hrefs = [...blog.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  const cards = hrefs.filter(href => href !== 'https://medium.com/@erdncyz');
  assert.deepEqual(cards, articleUrls);
  assert.equal(new Set(cards).size, cards.length);
  assert.equal(blog.includes('fa242e9f96e2'), true);
  assert.equal(blog.includes('d9b5a7f6f25c'), true);
  assert.equal(blog.includes('Swift Mimarisi'), false);
  assert.equal(blog.includes('Appium 3.0'), false);
  assert.match(blog, /data-en="Recent articles on AI-assisted development and coding agents\."/);
  assert.match(blog, /data-tr="Yapay zeka destekli geliştirme ve kodlama ajanları üzerine son yazılar\."/);
  assert.match(blog, /data-en="Read article"/);
  assert.match(blog, /data-tr="Yazıyı oku"/);
});

test('low-risk accessibility hooks are present', () => {
  assert.match(html, /<a class="skip-link" href="#main">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /id="mobile-menu-label"/);
  assert.match(html, /aria-expanded/);
  assert.match(html, /Menüyü kapat/);
  assert.match(html, /Close main menu/);
  for (const label of ['LinkedIn profile', 'GitHub profile', 'Instagram profile', 'Medium profile', 'X profile']) {
    assert.equal(html.split(label).length - 1 >= 2, true, label);
  }
});

test('profile matches the sourced LinkedIn fields and owner employment correction', () => {
  const experience = html.slice(html.indexOf('id="experience"'), html.indexOf('id="education"'));
  const duties = experience.split('id="experience-duties"')[1].split('</ul>')[0];
  assert.equal(duties.split('<li').length - 1, 10);
  assert.equal((experience.match(/<h3[^>]*>Software Test Automation Engineer<\/h3>/g) || []).length, 1);
  assert.equal(html.includes('Mobile Application Developer'), false);
  assert.equal(html.includes('Jun 2025'), false);
  assert.equal(html.includes('Haz 2025'), false);
  assert.equal(html.includes('>Ongoing<'), false);
  assert.equal(html.includes('Devam Ediyor'), false);
  assert.equal(html.includes('currently pursuing'), false);
  assert.equal(html.includes('id="certs"'), false);
  assert.equal(html.includes('Mindset Institute'), false);
  assert.equal(html.includes('Completed Certifications'), false);
  assert.equal(html.includes('w-[90%]'), false);
  assert.match(html, /id="digiturk-tenure"[^>]*data-tr="Tam zamanlı · Mart 2022’den beri"/);
  assert.match(html, /data-en="Full-time · Since March 2022"/);
  assert.match(experience, /Mar 2022 - Present/);
  assert.match(experience, /<\/i> Digiturk</);
  for (const range of ['2018 – Jan 2026', 'Sep 2022 – Sep 2026', '2014 – 2016', 'Jun 2020 – Jun 2022']) {
    assert.equal(html.includes(range), true, range);
  }
  assert.equal(html.includes('graduated'), false);
  assert.equal(html.split('id="education-list"')[1].split('</div>')[0].split('<article').length - 1, 4);
  assert.equal(html.split('id="volunteer-list"')[1].split('</ul>')[0].split('<li').length - 1, 3);
  assert.match(html, /METU Interview Days/);
  assert.match(html, /METU R&D Society/);
  assert.match(html, /METU Robotics Society/);
  assert.match(html, /id="language-en"[^>]*data-en="English — Professional working proficiency"/);
  assert.equal(html.includes('Native'), false);
  const skills = [...html.split('id="skill-list"')[1].split('</ul>')[0].matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)];
  assert.equal(skills.length, 41);
  const rendered = skills.map(item => item[1].replace(/<[^>]+>/g, '').trim());
  assert.equal(rendered[0], 'Karate');
  assert.equal(rendered[6], 'Load Testing');
  assert.equal(rendered[29], 'İnternational Software Testers Qualification Board');
  assert.equal(rendered[40], 'Postman API');
  assert.equal(new Set(rendered).size, 41);
  for (const href of ['#experience', '#education', '#volunteer', '#skills', '#ios-apps', '#projects', '#blog', '#hobbies']) {
    assert.equal(html.includes(`href="${href}"`), true, href);
  }
  assert.match(html, /id="hobbies"/);
  assert.match(html, /data-en="Rowing"/);
  assert.match(html, /data-en="Photography"/);
  assert.match(html, /data-en="3D Printing & Model Painting"/);
  assert.equal(html.includes('href="#certs"'), false);
  assert.match(html, /id="ios-apps"/);
  assert.match(html, /id="blog"/);
  assert.match(readme, /since March 2022/);
  assert.match(readme, /İnternational Software Testers Qualification Board/);
  assert.equal(readme.includes('Mindset Institute'), false);
  assert.equal(readme.includes('4 years 11 months'), false);
});

test('identity links and unrelated claims stay in place', () => {
  assert.match(html, /https:\/\/www\.linkedin\.com\/in\/erdinç-yılmaz-b07582152\//);
  assert.match(html, /https:\/\/github\.com\/erdncyz\/appium-device-farm/);
  assert.match(html, /https:\/\/apps\.apple\.com\/tr\/app\/yol-maliyetin\/id6804384620/);
  assert.match(html, /https:\/\/apps\.apple\.com\/ae\/app\/id6763359497/);
  assert.equal(html.includes('rel="canonical"'), false);
  assert.equal(html.includes('netlify.toml'), false);
});

test('live Medium RSS still lists these six articles first', async () => {
  const response = await fetch('https://medium.com/feed/@erdncyz', {
    headers: { 'user-agent': 'portfolio-guards' },
  });
  assert.equal(response.ok, true);
  const xml = await response.text();
  const links = [...xml.matchAll(/<link>(.*?)<\/link>/g)]
    .map(match => match[1].split('?')[0])
    .filter(link => link.includes('/@erdncyz/') && !link.endsWith('/@erdncyz'));
  assert.deepEqual(links.slice(0, 6), articleUrls);
});
