import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
