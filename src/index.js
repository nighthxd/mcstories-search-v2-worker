// src/index.js
import { scrapeAndProcessCategory } from './scraper';
import { tags } from '../categories';

export default {
    /**
     * This handles all incoming HTTP requests from your Netlify functions.
     */
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Security Check
        const secretKey = request.headers.get('X-CUSTOM-AUTH-KEY');
        if (secretKey !== env.NETLIFY_TO_CLOUDFLARE_SECRET) {
            return new Response('Unauthorized', { status: 401 });
        }

        // --- ROUTER ---
        if (url.pathname === '/save-stories' && request.method === 'POST') {
            return handleSaveStories(request, env);
        }
        if (url.pathname === '/search' && request.method === 'GET') {
            return handleSearch(request, env);
        }
        if (url.pathname === '/synopsis' && request.method === 'GET') {
            return handleSynopsis(request, env);
        }

        return new Response('Not Found', { status: 404 });
    },

    /**
     * This handles the scheduled cron job to scrape data.
     */
    async scheduled(event, env, ctx) {
        console.log(`Cron job triggered: ${event.cron}`);
        ctx.waitUntil(scrapeAndProcessCategory(env));
    },
};

/**
 * Handles saving scraped story data to the D1 database.
 */
async function handleSaveStories(request, env) {
    // ... (This function is correct and remains unchanged)
}

/**
 * Handles user-facing searches by querying the D1 database.
 */
async function handleSearch(request, env) {
    const { searchParams } = new URL(request.url);
    const includedTags = (searchParams.get('categories') || '').split(',').filter(Boolean);
    const excludedTags = (searchParams.get('excludedCategories') || '').split(',').filter(Boolean); // This was missing from the query logic
    const searchQuery = searchParams.get('query') || '';

    let query = 'SELECT title, url, categories, synopsis FROM stories';
    const params = [];
    const whereClauses = [];

    if (searchQuery) {
        whereClauses.push('title LIKE ?');
        params.push(`%${searchQuery}%`);
    }

    if (includedTags.length > 0) {
        includedTags.forEach(tag => {
            whereClauses.push('categories LIKE ?');
            params.push(`%${tag}%`);
        });
    }

    // --- THIS IS THE FIX ---
    if (excludedTags.length > 0) {
        excludedTags.forEach(tag => {
            whereClauses.push('categories NOT LIKE ?');
            params.push(`%${tag}%`);
        });
    }
    // --- END OF FIX ---

    if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
    }
    query += ' ORDER BY title;';
    
    const statement = env.STORIES_DB.prepare(query).bind(...params);
    const { results } = await statement.all();

    const stories = results.map(story => ({
        ...story,
        categories: story.categories ? story.categories.split(',') : []
    }));

    return new Response(JSON.stringify(stories), { headers: { 'Content-Type': 'application/json' } });
}

/**
 * Handles fetching a single synopsis from the database.
 */
async function handleSynopsis(request, env) {
    // ... (This function is correct and remains unchanged)
}