const i18n = require('i18n');
const path = require('path');

i18n.configure({
    locales: ['en', 'hi'],
    defaultLocale: 'en',
    directory: path.join(__dirname, '../locales'),
    objectNotation: true,
    updateFiles: false,
    cookie: 'lang'
});

module.exports = i18n; 