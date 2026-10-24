import React from 'react';

// Wrap a public keyed Chat renderer. Factories themselves reject replacement.
export function wrapUserRenderer(ctx, renderVoice) {
  return ctx.slots.inject('conversation.chat.node', () => {
    let disposeWrapper;
    function install() {
      if (disposeWrapper) return;
      const entry = ctx.slots.entriesOfSlot('conversation.chat.node').find(item => item.options.key === 'user');
      if (!entry) return; // The declaration can precede its shipped registrations.
      // Re-declaring child slots or borrowing private assembly is not supported.
      if (entry.children || entry.store || entry.inject) throw new Error('当前用户消息渲染器不能通过公开接口包装');
      const Original = entry.component;
      function VoiceMessageWrapper(props) {
        function renderFactorySlot(factory, input, options) {
          if (factory === 'conversation.chat.user.content') {
            const custom = renderVoice(input, props, props.renderFactorySlot, options);
            if (custom !== null) return custom;
          }
          return props.renderFactorySlot(factory, input, options);
        }
        return React.createElement(Original, { ...props, renderFactorySlot });
      }
      disposeWrapper = ctx.slots.register({
        name: 'conversation.chat.node', key: 'user',
        priority: (entry.options.priority ?? 0) - 1,
        ...(entry.locale ? { locale: entry.locale } : {}),
      }, VoiceMessageWrapper);
    }
    const unsubscribe = ctx.slots.subscribe('conversation.chat.node', install);
    install();
    return () => { unsubscribe(); disposeWrapper?.(); };
  });
}
