export default {
    async fetch(request, env) {
        // Simple security check
        const authKey = request.headers.get('X-CUSTOM-AUTH-KEY');
        if (authKey !== env.NETLIFY_TO_CLOUDFLARE_SECRET) {
            return new Response('Unauthorized', { status: 401 });
        }

        const url = new URL(request.url);

        // Route requests based on the URL path
        if (url.pathname === '/save-stories' && request.method === 'POST') {
            return handleSaveStories(request, env);
        }
        if (url.pathname === '/search' && request.method === 'GET') {
            return handleSearch(request, env);
        }

        return new Response('Not Found', { status: 404 });
    },
};

// Handles saving stories with "upsert" logic
async function handleSaveStories(request, env) {
    try {
        const stories = await request.json();
        if (!Array.isArray(stories) || stories.length === 0) {
            return new Response(JSON.stringify({ message: 'No stories to save.' }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let insertedCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;

        const checkStmt = env.STORIES_DB.prepare('SELECT url, synopsis, categories FROM stories WHERE url = ?');
        const insertStmt = env.STORIES_DB.prepare('INSERT INTO stories (title, url, synopsis, categories) VALUES (?, ?, ?, ?)');
        const updateStmt = env.STORIES_DB.prepare('UPDATE stories SET title = ?, synopsis = ?, categories = ? WHERE url = ?');
        
        const statements = [];

        for (const story of stories) {
            const { title, link, synopsis, categories } = story;
            const categoriesStr = categories.join(',').toLowerCase();

            const existing = await checkStmt.bind(link).first();

            if (existing) {
                const existingCategories = existing.categories || '';
                const existingSynopsis = existing.synopsis || '';
                
                if (existingCategories !== categoriesStr || existingSynopsis !== synopsis) {
                    statements.push(updateStmt.bind(title, synopsis, categoriesStr, link));
                    updatedCount++;
                } else {
                    unchangedCount++;
                }
            } else {
                statements.push(insertStmt.bind(title, link, synopsis, categoriesStr));
                insertedCount++;
            }
        }

        if (statements.length > 0) {
            await env.STORIES_DB.batch(statements);
        }

        const response = {
            message: 'Stories processed successfully.',
            inserted: insertedCount,
            updated: updatedCount,
            unchanged: unchangedCount
        };

        return new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Error in handleSaveStories:', error.message);
        return new Response(JSON.stringify({ error: 'Failed to save stories: ' + error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}


// Handles searching for stories
async function handleSearch(request, env) {
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('query') || '';
        const categories = (searchParams.get('categories') || '').split(',').filter(Boolean);
        const excludedCategories = (searchParams.get('excludedCategories') || '').split(',').filter(Boolean);

        let whereClauses = [];
        let bindings = [];

        if (query) {
            whereClauses.push("title LIKE ?");
            bindings.push(`%${query}%`);
        }

        categories.forEach(category => {
            whereClauses.push("categories LIKE ?");
            bindings.push(`%${category}%`);
        });

        excludedCategories.forEach(category => {
            whereClauses.push("categories NOT LIKE ?");
            bindings.push(`%${category}%`);
        });

        const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const finalQuery = `SELECT * FROM stories ${whereString} ORDER BY title ASC;`;

        const { results } = await env.STORIES_DB.prepare(finalQuery).bind(...bindings).all();

        const formattedResults = results.map(story => ({
            ...story,
            categories: story.categories ? story.categories.split(',') : []
        }));

        return new Response(JSON.stringify(formattedResults), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) { // The underscore has been removed from here.
        console.error('Error in handleSearch:', error.message);
        return new Response(JSON.stringify({ error: 'Failed to execute search: ' + error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}