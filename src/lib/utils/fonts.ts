export const fonts = {
  headings: {
    large: `
      font-weight: 600;
      font-size: calc(2.8 * var(--mp-unit));
      line-height: calc(3.4 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(3.4 * var(--mp-unit));
        line-height: calc(4.1 * var(--mp-unit));
      }
    `,
    medium: `
      font-weight: 600;
      font-size: calc(2.4 * var(--mp-unit));
      line-height: calc(2.9 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(2.8 * var(--mp-unit));
        line-height: calc(3.4 * var(--mp-unit));
      }
    `,
    small: `
      font-weight: 500;
      font-size: calc(1.8 * var(--mp-unit));
      line-height: calc(1.9 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.8 * var(--mp-unit));
        line-height: calc(2.2 * var(--mp-unit));
      }
      @media (min-width: 2560px) {
        font-size: calc(2.2 * var(--mp-unit));
        line-height: calc(2.6 * var(--mp-unit));
      }
    `,
    extraSmall: `
      font-weight: 500;
      font-size: calc(1.4 * var(--mp-unit));
      line-height: calc(1.7 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.6 * var(--mp-unit));
        line-height: calc(1.9 * var(--mp-unit));
      }
    `
  },
  bLarge: {
    bold: `
      font-weight: 600;
      font-size: calc(1.4 * var(--mp-unit));
      line-height: calc(2 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.6 * var(--mp-unit));
        line-height: calc(2.2 * var(--mp-unit));
      }
    `,
    medium: `
      font-weight: 500;
      font-size: calc(1.4 * var(--mp-unit));
      line-height: calc(2 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.6 * var(--mp-unit));
        line-height: calc(2.2 * var(--mp-unit));
      }
    `,
    regular: `
      font-weight: 400;
      font-size: calc(1.4 * var(--mp-unit));
      line-height: calc(2 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.6 * var(--mp-unit));
        line-height: calc(2.2 * var(--mp-unit));
      }
    `,
  },
  bMedium: {
    bold: `
      font-weight: 600;
      font-size: calc(1.2 * var(--mp-unit));
      line-height: calc(1.7 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.4 * var(--mp-unit));
        line-height: calc(2 * var(--mp-unit));
      }
    `,
    medium: `
      font-weight: 500;
      font-size: calc(1.2 * var(--mp-unit));
      line-height: calc(1.7 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.4 * var(--mp-unit));
        line-height: calc(2 * var(--mp-unit));
      }
    `,
    regular: `
      font-weight: 400;
      font-size: calc(1.2 * var(--mp-unit));
      line-height: calc(1.7 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.4 * var(--mp-unit));
        line-height: calc(2 * var(--mp-unit));
      }
    `,
  },
  bSmall: {
    bold: `
      font-weight: 600;
      font-size: calc(1 * var(--mp-unit));
      line-height: calc(1.4 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.2 * var(--mp-unit));
        line-height: calc(1.7 * var(--mp-unit));
      }
    `,
    medium: `
      font-weight: 500;
      font-size: calc(1 * var(--mp-unit));
      line-height: calc(1.4 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.2 * var(--mp-unit));
        line-height: calc(1.7 * var(--mp-unit));
      }
    `,
    regular: `
      font-weight: 400;
      font-size: calc(1 * var(--mp-unit));
      line-height: calc(1.4 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1.2 * var(--mp-unit));
        line-height: calc(1.7 * var(--mp-unit));
      }
    `,
  },
  bExtraSmall: {
    bold: `
      font-weight: 600;
      font-size: calc(0.8 * var(--mp-unit));
      line-height: calc(1.1 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1 * var(--mp-unit));
        line-height: calc(1.4 * var(--mp-unit));
      }
    `,
    medium: `
      font-weight: 500;
      font-size: calc(0.8 * var(--mp-unit));
      line-height: calc(1.1 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1 * var(--mp-unit));
        line-height: calc(1.4 * var(--mp-unit));
      }
    `,
    regular: `
      font-weight: 400;
      font-size: calc(0.8 * var(--mp-unit));
      line-height: calc(1.1 * var(--mp-unit));
      @media (min-width: 960px) {
        font-size: calc(1 * var(--mp-unit));
        line-height: calc(1.4 * var(--mp-unit));
      }
    `,
  },
}