module.exports = {
  // ...existing config
  theme: {
    extend: {
      // ...existing extensions
      animation: {
        'spin': 'spin 1s linear infinite',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}