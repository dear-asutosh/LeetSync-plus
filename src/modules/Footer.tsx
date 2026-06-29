import { HStack, Text } from '@chakra-ui/react';
import React from 'react';

export const Footer = () => {
  return (
    <HStack align="center">
      <Text fontSize={'12px'}>
        Having Issues?{' '}
        <Text
          as="a"
          color="blue.500"
          href="https://github.com/dear-asutosh/GitLeet/issues/new/choose"
          target="_blank"
          fontWeight={'semibold'}
        >
          issues/new/choose
        </Text>{' '}
        | Made with <span style={{ color: '#e25555' }}>&#9829;</span> by{' '}
        <Text
          as="a"
          color="blue.500"
          href="https://github.com/dear-asutosh"
          target="_blank"
          fontWeight={'semibold'}
          display="inline-block"
        >
          Asutosh
        </Text>
      </Text>
    </HStack>
  );
};
