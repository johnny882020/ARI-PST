module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', ['public-site','web','api','domain','contracts','api-client','design-system','i18n','synthetic-data','db','infra','ci','docs','deps']],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 72],
  },
};
