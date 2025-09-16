import puppeteer from '@cloudflare/puppeteer';
import * as cheerio from 'cheerio';
import { tags } from '../categories';

export async function scrapeAndProcessCategory(env) {
    console.log("--- RUNNING SCRAPER V3 ---"); // New version to confirm deployment
    let browser = null;
    try {
        const stateQuery = 'SELECT last_scraped_category_index FROM scrape_state WHERE id = 1';
        let stateResult = await env.STORIES_DB.prepare(stateQuery).first();

        if (!stateResult) {
            await env.STORIES_DB.prepare('INSERT INTO scrape_state (id, last_scraped_category_index) VALUES (1, -1)').run();
            stateResult = { last_scraped_category_index: -1 };
        }

        const lastIndex = stateResult.last_scraped_category_index;
        const categoryKeys = Object.keys(tags);
        const nextIndex = (lastIndex + 1) % categoryKeys.length;
        const categoryToScrape = categoryKeys[nextIndex];
        const urlToScrape = tags[categoryToScrape];
        
        console.log(`[V3] Starting scrape for category: [${categoryToScrape.toUpperCase()}]`);

        browser = await puppeteer.launch(env.MY_BROWSER);
        const page = await browser.newPage();

        console.log(`[V3] Navigating to page: ${urlToScrape}`);
        await page.goto(urlToScrape, { waitUntil: 'networkidle0' });
        console.log(`[V3] Page navigation successful. Getting content...`);
        const data = await page.content();
        console.log(`[V3] Got page content. Starting to parse with Cheerio...`);
        
        const $ = cheerio.load(data);
        const stories = [];
        $('a[href$="/index.html"]').each((i, element) => {
            const title = $(element).text().trim();
            const link = $(element).attr('href');
            if (title && link) {
                try {
                    const fullLink = new URL(link, urlToScrape).href;
                    if (!fullLink.includes('/Authors/') && !fullLink.includes('/Tags/')) {
                        stories.push({ title, link: fullLink, categories: [categoryToScrape] });
                    }
                } catch (e) {
                    console.error(`[V3] FAILED to parse link. Base URL: ${urlToScrape}, Invalid href: "${link}"`);
                }
            }
        });
        
        console.log(`[V3] Finished parsing. Found ${stories.length} stories.`);

        if (stories.length > 0) {
            // Synopsis scraping and DB saving logic would go here, but let's confirm this part works first.
            console.log(`[V3] SUCCESS: Would now proceed to save ${stories.length} stories.`);
        }
        
        // For now, we update the state regardless to avoid getting stuck
        await env.STORIES_DB.prepare('UPDATE scrape_state SET last_scraped_category_index = ?1 WHERE id = 1').bind(nextIndex).run();
        console.log(`[V3] Successfully finished for category: [${categoryToScrape.toUpperCase()}]`);
        
    } catch (error) {
        console.error("[V3] CRITICAL ERROR in main block:", error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}