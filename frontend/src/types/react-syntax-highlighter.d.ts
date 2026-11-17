declare module 'react-syntax-highlighter' {
  import * as React from 'react';
  export const Prism: React.ComponentType<any>;
  export default Prism;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  const styles: { [key: string]: any };
  export const oneDark: any;
  export default styles;
}
