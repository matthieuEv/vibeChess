export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_analysis_state',
      description: 'Get the current state of the chess analysis board. Returns FEN, last move played (to reach this state), next move (played from this state), and engine suggestions.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_analysis',
      description: 'Navigate through the game analysis history. You can move forward, backward, or jump to a specific move.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['next', 'previous', 'start', 'end', 'jump'],
            description: 'The navigation action to perform.',
          },
          index: {
            type: 'number',
            description: 'The move index to jump to (only used if action is "jump"). 0 is the start of the game.',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'make_analysis_move',
      description: 'Make a move on the analysis board to explore a variation. Use this to show a specific move to the user (e.g. a better move suggested by the engine).',
      parameters: {
        type: 'object',
        properties: {
          move: {
            type: 'string',
            description: 'The move to make in SAN format (e.g. "Nf3", "O-O").',
          },
        },
        required: ['move'],
      },
    },
  },
]
