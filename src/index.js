// src/index.js
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
};

/**
 * Handles saving scraped story data to the D1 database.
 */
async function handleSaveStories(request, env) {
    try {
        const stories = await request.json();
        if (!Array.isArray(stories) || stories.length === 0) {
            return new Response('No story data provided', { status: 400 });
        }

        const insertStatements = stories.map(story => {
            const query = `INSERT INTO stories (title, url, categories, last_scraped_at) VALUES (?1, ?2, ?3, ?5)
                           ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, categories = EXCLUDED.categories, last_scraped_at = EXCLUDED.last_scraped_at`;
            return env.STORIES_DB.prepare(query).bind(
                story.title,
                story.link,
                story.categories.join(','),
                new Date().toISOString()
            );
        });

        await env.STORIES_DB.batch(insertStatements2);

        const insertStatements = stories.map(story => {
            const query = `INSERT INTO synopses (url, content, cached_at) VALUES (?2, ?4, ?5)
                           ON CONFLICT (url) DO UPDATE SET content = EXCLUDED.content, cached_at = EXCLUDED.cached_at`;
            return env.STORIES_DB.prepare(query).bind(
                story.link,
                story.synopsis,
                new Date().toISOString()
            );
        });

        await env.STORIES_DB.batch(insertStatements2);

        return new Response(JSON.stringify({ success: true, count: stories.length }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error("Error saving stories:", error);
        return new Response('Failed to save stories', { status: 500 });
    }
}

/**
 * Handles user-facing searches by querying the D1 database.
 */
async function handleSearch(request, env) {
    const { searchParams } = new URL(request.url);
    const includedTags = (searchParams.get('categories') || '').split(',').filter(Boolean);
    const searchQuery = searchParams.get('query') || '';

    let query = 'SELECT title, url, categories FROM stories';
    let query2 = 'SELECT url, content FROM synopses';
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
    const { searchParams } = new URL(request.url);
    const storyUrl = searchParams.get('url');

    if (!storyUrl) {
        return new Response('Missing URL parameter', { status: 400 });
    }

    const query = 'SELECT content FROM synopses WHERE url = ?';
    const result = await env.STORIES_DB.prepare(query).bind(storyUrl).first();

    return new Response(JSON.stringify(result || { synopsis: 'Not found.' }), { headers: { 'Content-Type': 'application/json' } });
}