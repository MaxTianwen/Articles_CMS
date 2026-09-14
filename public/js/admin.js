(() => {
    'use strict';
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    const sidebar = document.getElementById('sidebar'),
        menu = document.getElementById('menu-toggle');
    const mobile = window.matchMedia('(max-width: 760px)');
    function syncNavigation() {
        if (sidebar)
            sidebar.inert =
                mobile.matches && !sidebar.classList.contains('open');
    }
    function closeMenu() {
        sidebar?.classList.remove('open');
        menu?.setAttribute('aria-expanded', 'false');
        syncNavigation();
    }
    menu?.addEventListener('click', () => {
        const open = sidebar.classList.toggle('open');
        menu.setAttribute('aria-expanded', String(open));
        syncNavigation();
    });
    mobile.addEventListener('change', closeMenu);
    syncNavigation();
    document.addEventListener('click', (event) => {
        if (
            sidebar &&
            !sidebar.contains(event.target) &&
            !menu?.contains(event.target)
        )
            closeMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sidebar?.classList.contains('open')) {
            closeMenu();
            menu.focus();
        }
    });
    document
        .getElementById('show-password')
        ?.addEventListener('change', (event) => {
            document.getElementById('password').type = event.target.checked
                ? 'text'
                : 'password';
        });
    // Broken or untrusted legacy covers have an accessible local fallback.
    document.querySelectorAll('img').forEach((img) =>
        img.addEventListener('error', () => {
            if (!img.src.endsWith('/image-placeholder.svg'))
                img.src = '/image-placeholder.svg';
        }),
    );

    async function request(url, options) {
        const response = await fetch(url, {
            ...options,
            headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
        });
        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error(
                'The server returned an unexpected response. Your input has been kept.',
            );
        }
        if (!response.ok) {
            const error = new Error(
                response.status === 401
                    ? 'Your session has expired. Sign in in another tab, then reload before saving. Copy your text first.'
                    : data.message || 'The request failed.',
            );
            error.fields = data.fields || {};
            throw error;
        }
        return data;
    }
    const dialog = document.getElementById('delete-dialog'),
        confirmDelete = document.getElementById('confirm-delete');
    let deleteId = null;
    document.querySelectorAll('.delete-trigger').forEach((button) =>
        button.addEventListener('click', () => {
            deleteId = button.dataset.id;
            document.getElementById('delete-description').textContent =
                '“' + button.dataset.title + '”';
            document.getElementById('delete-error').hidden = true;
            dialog.showModal();
            document.getElementById('cancel-delete').focus();
        }),
    );
    document
        .getElementById('cancel-delete')
        ?.addEventListener('click', () => dialog.close());
    confirmDelete?.addEventListener('click', async () => {
        if (!deleteId || confirmDelete.disabled) return;
        confirmDelete.disabled = true;
        confirmDelete.textContent = 'Deleting…';
        try {
            await request('/articles/' + deleteId, { method: 'DELETE' });
            window.location.assign(
                window.location.pathname === '/articles'
                    ? window.location.href
                    : '/articles',
            );
        } catch (error) {
            const alert = document.getElementById('delete-error');
            alert.textContent = error.message;
            alert.hidden = false;
        } finally {
            confirmDelete.disabled = false;
            confirmDelete.textContent = 'Delete article';
        }
    });
    const form = document.getElementById('article-form');
    if (!form) return;
    const title = document.getElementById('title'),
        content = document.getElementById('content');
    const file = document.getElementById('featureImage'),
        image = document.getElementById('cover-preview');
    const remove = document.getElementById('removeImage'),
        clear = document.getElementById('clear-new-image');
    const errorBox = document.getElementById('form-error'),
        save = document.getElementById('save-button');
    let dirty = false,
        saving = false,
        previewUrl = null;
    function words() {
        document.getElementById('word-count').textContent =
            (content.value.trim().match(/\S+/g) || []).length + ' words';
    }
    function markDirty() {
        dirty = true;
        document.getElementById('save-state').textContent = 'Unsaved changes';
        words();
    }
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    words();
    window.addEventListener('beforeunload', (event) => {
        if (dirty) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    function clearErrors() {
        errorBox.hidden = true;
        form.querySelectorAll('.is-invalid').forEach((element) => {
            element.classList.remove('is-invalid');
            element.removeAttribute('aria-invalid');
        });
        form.querySelectorAll('.invalid-feedback').forEach((element) => {
            element.textContent = '';
        });
    }
    function showError(error) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
        for (const [field, message] of Object.entries(error.fields || {})) {
            const input = document.getElementById(field),
                output = document.getElementById('error-' + field);
            if (input) {
                input.classList.add('is-invalid');
                input.setAttribute('aria-invalid', 'true');
            }
            if (output) output.textContent = message;
        }
        errorBox.focus();
    }
    function resetPreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        image.src = remove?.checked
            ? '/image-placeholder.svg'
            : image.dataset.original;
    }
    file.addEventListener('change', () => {
        clearErrors();
        resetPreview();
        const selected = file.files[0];
        clear.hidden = !selected;
        if (!selected) return;
        if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(
                selected.type,
            ) ||
            selected.size > 4 * 1024 * 1024
        ) {
            file.value = '';
            clear.hidden = true;
            showError({
                message: 'Choose a JPEG, PNG or WebP image smaller than 4 MB.',
                fields: { featureImage: 'Invalid image type or size.' },
            });
            return;
        }
        if (remove) remove.checked = false;
        previewUrl = URL.createObjectURL(selected);
        image.src = previewUrl;
    });
    clear.addEventListener('click', () => {
        file.value = '';
        clear.hidden = true;
        resetPreview();
        markDirty();
    });
    remove?.addEventListener('change', () => {
        if (remove.checked) {
            file.value = '';
            clear.hidden = true;
        }
        resetPreview();
    });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (saving || !form.reportValidity()) return;
        clearErrors();
        saving = true;
        save.disabled = true;
        save.querySelector('span').textContent = 'Saving…';
        const data = new FormData(form);
        if (!file.files.length) data.delete('featureImage');
        try {
            const id = form.dataset.articleId;
            const result = await request(
                id ? '/articles/' + id : '/articles/add',
                { method: id ? 'PUT' : 'POST', body: data },
            );
            dirty = false;
            document.getElementById('save-state').textContent = 'Saved';
            window.location.assign(result.redirect);
        } catch (error) {
            showError(error);
        } finally {
            saving = false;
            save.disabled = false;
            save.querySelector('span').textContent = 'Save article';
        }
    });
    const preview = document.getElementById('preview-dialog');
    document.getElementById('preview-button').addEventListener('click', () => {
        document.getElementById('preview-title').textContent =
            title.value || 'Untitled article';
        document.getElementById('preview-content').textContent =
            content.value || 'Your story will appear here.';
        document.getElementById('preview-author').textContent =
            'By ' + (document.getElementById('author').value || 'Author');
        document.getElementById('preview-category').textContent =
            document.getElementById('category').selectedOptions[0]
                ?.textContent || '';
        const previewImage = document.getElementById('preview-image');
        previewImage.src = image.src;
        previewImage.hidden = image.src.endsWith('/image-placeholder.svg');
        preview.showModal();
    });
    document
        .getElementById('close-preview')
        .addEventListener('click', () => preview.close());
})();
