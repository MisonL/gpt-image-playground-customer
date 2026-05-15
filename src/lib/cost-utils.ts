type ApiUsage = {
    input_tokens_details?: {
        text_tokens?: number;
        image_tokens?: number;
    };
    output_tokens?: number;
};

export type CostDetails = {
    estimated_cost_usd: number;
    text_input_tokens: number;
    image_input_tokens: number;
    image_output_tokens: number;
};

// gpt-image-1 价格。
const GPT_IMAGE_1_TEXT_INPUT_COST_PER_TOKEN = 0.000005; // $5.00/1M
const GPT_IMAGE_1_IMAGE_INPUT_COST_PER_TOKEN = 0.00001; // $10.00/1M
const GPT_IMAGE_1_IMAGE_OUTPUT_COST_PER_TOKEN = 0.00004; // $40.00/1M

// gpt-image-1-mini 价格。
const GPT_IMAGE_1_MINI_TEXT_INPUT_COST_PER_TOKEN = 0.000002; // $2.00/1M
const GPT_IMAGE_1_MINI_IMAGE_INPUT_COST_PER_TOKEN = 0.0000025; // $2.50/1M
const GPT_IMAGE_1_MINI_IMAGE_OUTPUT_COST_PER_TOKEN = 0.000008; // $8.00/1M

// gpt-image-1.5 价格。
const GPT_IMAGE_1_5_TEXT_INPUT_COST_PER_TOKEN = 0.000005; // $5.00/1M
const GPT_IMAGE_1_5_IMAGE_INPUT_COST_PER_TOKEN = 0.000008; // $8.00/1M
const GPT_IMAGE_1_5_IMAGE_OUTPUT_COST_PER_TOKEN = 0.000032; // $32.00/1M

// gpt-image-2 价格。
const GPT_IMAGE_2_TEXT_INPUT_COST_PER_TOKEN = 0.000005; // $5.00/1M
const GPT_IMAGE_2_IMAGE_INPUT_COST_PER_TOKEN = 0.000008; // $8.00/1M
const GPT_IMAGE_2_IMAGE_OUTPUT_COST_PER_TOKEN = 0.00003; // $30.00/1M

export type GptImageModel = 'gpt-image-1' | 'gpt-image-1-mini' | 'gpt-image-1.5' | 'gpt-image-2';

export type ModelRates = {
    textInputPerToken: number;
    imageInputPerToken: number;
    imageOutputPerToken: number;
    textInputPerMillion: number;
    imageInputPerMillion: number;
    imageOutputPerMillion: number;
};

export function getModelRates(model: GptImageModel): ModelRates {
    if (model === 'gpt-image-1-mini') {
        return {
            textInputPerToken: GPT_IMAGE_1_MINI_TEXT_INPUT_COST_PER_TOKEN,
            imageInputPerToken: GPT_IMAGE_1_MINI_IMAGE_INPUT_COST_PER_TOKEN,
            imageOutputPerToken: GPT_IMAGE_1_MINI_IMAGE_OUTPUT_COST_PER_TOKEN,
            textInputPerMillion: 2,
            imageInputPerMillion: 2.5,
            imageOutputPerMillion: 8
        };
    }
    if (model === 'gpt-image-1.5') {
        return {
            textInputPerToken: GPT_IMAGE_1_5_TEXT_INPUT_COST_PER_TOKEN,
            imageInputPerToken: GPT_IMAGE_1_5_IMAGE_INPUT_COST_PER_TOKEN,
            imageOutputPerToken: GPT_IMAGE_1_5_IMAGE_OUTPUT_COST_PER_TOKEN,
            textInputPerMillion: 5,
            imageInputPerMillion: 8,
            imageOutputPerMillion: 32
        };
    }
    if (model === 'gpt-image-2') {
        return {
            textInputPerToken: GPT_IMAGE_2_TEXT_INPUT_COST_PER_TOKEN,
            imageInputPerToken: GPT_IMAGE_2_IMAGE_INPUT_COST_PER_TOKEN,
            imageOutputPerToken: GPT_IMAGE_2_IMAGE_OUTPUT_COST_PER_TOKEN,
            textInputPerMillion: 5,
            imageInputPerMillion: 8,
            imageOutputPerMillion: 30
        };
    }
    return {
        textInputPerToken: GPT_IMAGE_1_TEXT_INPUT_COST_PER_TOKEN,
        imageInputPerToken: GPT_IMAGE_1_IMAGE_INPUT_COST_PER_TOKEN,
        imageOutputPerToken: GPT_IMAGE_1_IMAGE_OUTPUT_COST_PER_TOKEN,
        textInputPerMillion: 5,
        imageInputPerMillion: 10,
        imageOutputPerMillion: 40
    };
}

/**
 * 根据 token 用量估算 GPT 图片模型 API 调用成本。
 * @param usage OpenAI API 响应中的 usage 对象。
 * @param model 使用的模型。
 * @returns CostDetails 对象；usage 数据无效时返回 null。
 */
export function calculateApiCost(
    usage: ApiUsage | undefined | null,
    model: GptImageModel = 'gpt-image-2'
): CostDetails | null {
    if (!usage || !usage.input_tokens_details || usage.output_tokens === undefined || usage.output_tokens === null) {
        console.warn('费用计算缺少有效 usage 数据：', usage);
        return null;
    }

    const textInT = usage.input_tokens_details.text_tokens ?? 0;
    const imgInT = usage.input_tokens_details.image_tokens ?? 0;
    const imgOutT = usage.output_tokens ?? 0;

    // 校验 token 类型。
    if (typeof textInT !== 'number' || typeof imgInT !== 'number' || typeof imgOutT !== 'number') {
        console.error('usage 数据中的 token 类型无效：', usage);
        return null;
    }

    // 按模型选择价格。
    let textInputCost: number;
    let imageInputCost: number;
    let imageOutputCost: number;

    if (model === 'gpt-image-1-mini') {
        textInputCost = GPT_IMAGE_1_MINI_TEXT_INPUT_COST_PER_TOKEN;
        imageInputCost = GPT_IMAGE_1_MINI_IMAGE_INPUT_COST_PER_TOKEN;
        imageOutputCost = GPT_IMAGE_1_MINI_IMAGE_OUTPUT_COST_PER_TOKEN;
    } else if (model === 'gpt-image-1.5') {
        textInputCost = GPT_IMAGE_1_5_TEXT_INPUT_COST_PER_TOKEN;
        imageInputCost = GPT_IMAGE_1_5_IMAGE_INPUT_COST_PER_TOKEN;
        imageOutputCost = GPT_IMAGE_1_5_IMAGE_OUTPUT_COST_PER_TOKEN;
    } else if (model === 'gpt-image-2') {
        textInputCost = GPT_IMAGE_2_TEXT_INPUT_COST_PER_TOKEN;
        imageInputCost = GPT_IMAGE_2_IMAGE_INPUT_COST_PER_TOKEN;
        imageOutputCost = GPT_IMAGE_2_IMAGE_OUTPUT_COST_PER_TOKEN;
    } else {
        // 默认按 gpt-image-1 计价。
        textInputCost = GPT_IMAGE_1_TEXT_INPUT_COST_PER_TOKEN;
        imageInputCost = GPT_IMAGE_1_IMAGE_INPUT_COST_PER_TOKEN;
        imageOutputCost = GPT_IMAGE_1_IMAGE_OUTPUT_COST_PER_TOKEN;
    }

    const costUSD = textInT * textInputCost + imgInT * imageInputCost + imgOutT * imageOutputCost;

    // 保留 4 位小数。
    const costRounded = Math.round(costUSD * 10000) / 10000;

    return {
        estimated_cost_usd: costRounded,
        text_input_tokens: textInT,
        image_input_tokens: imgInT,
        image_output_tokens: imgOutT
    };
}
