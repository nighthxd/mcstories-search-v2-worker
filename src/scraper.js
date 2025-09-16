// src/scraper.js - initial version
import puppeteer from '@cloudflare/puppeteer';
import { tags } from '../categories';

/**
 * This is the main function for the scheduled task.
 * It figures out which category to scrape next, scrapes it, and saves the data.
 */
export async function scrapeAndProcessCategory(env) {
    let browser = null;
    try {
        // 1. Get the last scraped category index from the database
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
        
        console.log(`Starting scheduled scrape for category: [${categoryToScrape.toUpperCase()}]`);

        // 2. Connect to Cloudflare's remote browser
        browser = await puppeteer.launch(env.MY_BROWSER);

        // 3. Scrape the index page to get story links
        const storiesOnPage = await scrapeIndexPage(browser, urlToScrape);
        if (storiesOnPage.length === 0) {
            console.log(`No stories found for category [${categoryToScrape.toUpperCase()}]. Skipping.`);
        } else {
             // 4. Scrape all synopses for the found stories
            console.log(`Found ${storiesOnPage.length} stories. Fetching synopses...`);
            const synopsisPromises = storiesOnPage.map(story =>
                scrapeSynopsisPage(browser, story.link).then(synopsis => {
                    story.synopsis = synopsis;
                    return story;
                })
            );
            const storiesWithData = await Promise.all(synopsisPromises);

            // 5. Save the complete data to the database
            console.log(`Saving ${storiesWithData.length} stories to the database...`);
            const insertStatements = storiesWithData.map(story => {
                const query = `INSERT INTO stories (title, url, categories, synopsis, last_scraped_at) VALUES (?1, ?2, ?3, ?4, ?5)
                           ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, categories = EXCLUDED.categories, synopsis = EXCLUDED.synopsis, last_scraped_at = EXCLUDED.last_scraped_at`;
                return env.STORIES_DB.prepare(query).bind(
                    story.title,
                    story.link,
                    story.categories.join(','),
                    story.synopsis,
                    new Date().toISOString()
                );
            });
            await env.STORIES_DB.batch(insertStatements);
        }

        // 6. Update the state for the next run
        await env.STORIES_DB.prepare('UPDATE scrape_state SET last_scraped_category_index = ?1 WHERE id = 1').bind(nextIndex).run();
        console.log(`Successfully finished scrape for category: [${categoryToScrape.toUpperCase()}]`);
        
    } catch (error) {
        console.error("Error during scheduled scrape:", error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}


// --- Helper Functions ---

async function scrapeIndexPage(browser, url) {
    // ... (This function remains the same as in the warm-cache.js file)
}

async function scrapeSynopsisPage(browser, storyUrl) {
    // ... (This function remains the same as in the warm-cache.js file)
}