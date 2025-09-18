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

// Handles saving stories with "upsert" logic to minimize writes
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

        // Prepare statements for reuse
        const checkStmt = env.D1_DB.prepare('SELECT url, synopsis, categories FROM stories WHERE url = ?');
        const insertStmt = env.D1_DB.prepare('INSERT INTO stories (title, url, synopsis, categories) VALUES (?, ?, ?, ?)');
        const updateStmt = env.D1_DB.prepare('UPDATE stories SET title = ?, synopsis = ?, categories = ? WHERE url = ?');
        
        const statements = [];

        for (const story of stories) {
            const { title, link, synopsis, categories } = story;
            const categoriesStr = categories.join(',').toLowerCase();

            // 1. Read the database to see if the story already exists
            const existing = await checkStmt.bind(link).first();

            if (existing) {
                // 2. Story exists: check if an update is needed
                const existingCategories = existing.categories || '';
                const existingSynopsis = existing.synopsis || '';
                
                // Compare categories and synopsis to see if data has changed
                if (existingCategories !== categoriesStr || existingSynopsis !== synopsis) {
                    statements.push(updateStmt.bind(title, synopsis, categoriesStr, link));
                    updatedCount++;
                } else {
                    unchangedCount++;
                }
            } else {
                // 3. Story does not exist: insert it
                statements.push(insertStmt.bind(title, link, synopsis, categoriesStr));
                insertedCount++;
            }
        }

        // Execute all database operations in a single batch transaction
        if (statements.length > 0) {
            await env.D1_DB.batch(statements);
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
        console.error('Error in handleSaveStories:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}


// Handles searching for stories (no changes needed here)
async function handleSearch(request, env) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') || '';
    const categories = (searchParams.get('categories') || '').split(',').filter(Boolean);
    const excludedCategories = (searchParams.get('excludedCategories') || '').split(',').filter(Boolean);

    let whereClauses = [];
    let bindings = [];

    // Title search
    if (query) {
        whereClauses.push("title LIKE ?");
        bindings.push(`%${query}%`);
    }

    // Included categories (AND logic)
    categories.forEach(category => {
        whereClauses.push("categories LIKE ?");
        bindings.push(`%${category}%`);
    });

    // Excluded categories (AND NOT logic)
    excludedCategories.forEach(category => {
        whereClauses.push("categories NOT LIKE ?");
        bindings.push(`%${category}%`);
    });

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const finalQuery = `SELECT * FROM stories ${whereString} ORDER BY title ASC;`;

    try {
        const { results } = await env.D1_DB.prepare(finalQuery).bind(...bindings).all();

        // Convert categories from string back to array for the frontend
        const formattedResults = results.map(story => ({
            ...story,
            categories: story.categories ? story.categories.split(',') : []
        }));

        return new Response(JSON.stringify(formattedResults), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error in handleSearch:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
