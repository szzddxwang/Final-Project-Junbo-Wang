'use strict';
const grid = document.querySelector('#topic-grid');
const search = document.querySelector('#search');
const category = document.querySelector('#category');
const tag = document.querySelector('#tag');
let items = [];
function render() {
  const query = search.value.trim().toLowerCase();
  const shown = items.filter(item => (!category.value || category.value === item.id) &&
    (!tag.value || item.tags.includes(tag.value)) &&
    (!query || [item.title, item.summary, ...item.tags].join(' ').toLowerCase().includes(query)));
  grid.replaceChildren(...shown.map(item => {
    const card = document.createElement('article'); card.className = 'topic-card';
    const top = document.createElement('div'); top.className = 'card-top';
    const icon = document.createElement('span'); icon.className = 'topic-icon'; icon.textContent = item.icon;
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = item.difficulty;
    top.append(icon, badge);
    const title = document.createElement('h3'); title.textContent = item.title;
    const summary = document.createElement('p'); summary.textContent = item.summary;
    const tags = document.createElement('div'); tags.className = 'tags';
    item.tags.forEach(value => { const element = document.createElement('span'); element.textContent = value; tags.append(element); });
    card.append(top, title, summary, tags);
    if (item.related_tool) { const link = document.createElement('a'); link.className = 'card-link'; link.href = item.related_tool; link.textContent = 'Try it yourself ↗'; card.append(link); }
    else { const hint = document.createElement('span'); hint.className = 'coming'; hint.textContent = 'Learning pathway'; card.append(hint); }
    return card;
  }));
  document.querySelector('#empty').hidden = shown.length > 0;
  document.querySelector('#result-count').textContent = `${shown.length} topic${shown.length === 1 ? '' : 's'}`;
}
fetch('/ai/topics/catalog').then(response => { if (!response.ok) throw new Error('Catalog unavailable'); return response.json(); }).then(data => {
  items = data.categories;
  items.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; category.append(option); });
  [...new Set(items.flatMap(item => item.tags))].sort().forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; tag.append(option); });
  render();
}).catch(error => { document.querySelector('#empty').hidden = false; document.querySelector('#empty').textContent = error.message; });
[search, category, tag].forEach(element => element.addEventListener('input', render));
document.querySelector('#clear').addEventListener('click', () => { search.value = ''; category.value = ''; tag.value = ''; render(); search.focus(); });
