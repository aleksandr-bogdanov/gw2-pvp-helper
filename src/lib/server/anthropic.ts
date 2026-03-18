import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY } from '$env/static/private';

export const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
