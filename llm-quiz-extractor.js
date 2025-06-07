// llm-quiz-extractor.js
window.QuizExtractor = class QuizExtractor {
    constructor(apiKey = '') {
        this.apiKey = apiKey;
        this.model = 'google/gemma-2-2b-it';  // Update to use Gemma model
        this.apiUrl = 'https://router.huggingface.co/nebius/v1/chat/completions';  // Update to chat completions endpoint
    }

    async extractQuestionsFromPDF(pdfFile) {
        try {
            showLoading();
            const pdfText = await this.extractTextFromPDF(pdfFile);
            

            // Prepare the chat message
            const messages = [{
                role: "user",
                content: `You are an expert at creating and validating quiz questions. Given the following content from a PDF, 
            extract or generate multiple choice questions with 4 options (A, B, C, D) and their correct answers.
            
            Content from PDF:
            ${pdfText}
            
            Your task is to:
            1. Extract all questions, their options, and correct answers
            2. If questions are present but correct answers are missing, use your knowledge to determine the correct answer
            3. If no questions are present, generate relevant questions based on the content
            
            For each question:
            - Ensure it's clear and well-formatted
            - Have exactly 4 options (A, B, C, D)
            - Have exactly one correct answer
            - If you're unsure about the correct answer, mark it as needing verification
            
            Format your response as a JSON object with the following structure:
            {
                "questions": [
                    {
                        "id": number,
                        "question": "question text",
                        "options": {
                            "A": "option A",
                            "B": "option B",
                            "C": "option C",
                            "D": "option D"
                        },
                        "correct_answer": "correct option key (A, B, C, or D)",
                        "needs_verification": boolean
                    }
                ]
            }
            
            Important:
            - Pay attention to the structure of the content
            - Handle different question formats (numbered, bulleted, etc.)
            - Preserve the original question wording
            - Preserve the order of the questions
            - If you're unsure about any part of a question, mark it for verification
            - Respond ONLY with the JSON object, no additional text`
            }];

            console.log('=== API Request ===');
            console.log('URL:', this.apiUrl);
            console.log('Model:', this.model);
            console.log('Messages:', messages);

            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    messages: messages,
                    model: this.model,
                    stream: false
                })
            });

            console.log('=== API Response Status ===');
            console.log('Status:', response.status);
            console.log('Status Text:', response.statusText);
            console.log('Headers:', Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
                if (response.status === 503) {
                    throw new Error('Model is loading, please try again in a few seconds');
                }
                throw new Error(`API request failed: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('=== Raw API Response ===');
            console.log(JSON.stringify(data, null, 2));

            const content = data.choices[0].message.content;
            console.log('=== Extracted Content ===');
            console.log(content);
            
            // Try to extract JSON from the response
            try {
                // First try to find JSON in the response
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    console.log('=== Found JSON Match ===');
                    console.log(jsonMatch[0]);
                    const result = JSON.parse(jsonMatch[0]);
                    console.log('=== Parsed JSON ===');
                    console.log(JSON.stringify(result, null, 2));
                    return result.questions || [];
                }
                
                console.log('=== No JSON Found, Using Text Parser ===');
                // If no JSON found, try to parse the text into questions
                const questions = this.parseTextToQuestions(content);
                console.log('=== Parsed Questions ===');
                console.log(JSON.stringify(questions, null, 2));
                return questions;
            } catch (error) {
                console.error('=== Error Parsing Response ===');
                console.error(error);
                throw new Error('Could not parse questions from model response');
            }

        } catch (error) {
            console.error('=== Error in extractQuestionsFromPDF ===');
            console.error(error);
            throw error;
        } finally {
            hideLoading();
        }
    }

    parseTextToQuestions(text) {
        // Simple parser to convert text into questions
        const questions = [];
        const lines = text.split('\n');
        let currentQuestion = null;
        
        for (const line of lines) {
            if (line.match(/^\d+[\.\)]/)) {
                // New question
                if (currentQuestion) {
                    questions.push(currentQuestion);
                }
                currentQuestion = {
                    id: questions.length + 1,
                    question: line.replace(/^\d+[\.\)]\s*/, '').trim(),
                    options: {},
                    correct_answer: null
                };
            } else if (line.match(/^[A-D][\.\)]/) && currentQuestion) {
                // Option
                const option = line[0];
                const optionText = line.replace(/^[A-D][\.\)]\s*/, '').trim();
                currentQuestion.options[option] = optionText;
            } else if (line.match(/^Answer:/i) && currentQuestion) {
                // Correct answer
                const answerMatch = line.match(/[A-D]/i);
                if (answerMatch) {
                    currentQuestion.correct_answer = answerMatch[0].toUpperCase();
                }
            }
        }
        
        // Add the last question if exists
        if (currentQuestion) {
            questions.push(currentQuestion);
        }
        
        return questions;
    }

    async extractTextFromPDF(pdfFile) {
        // Load PDF.js
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        try {
            const arrayBuffer = await pdfFile.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + '\n';
            }
            
            return fullText;
        } catch (error) {
            console.error('Error extracting text from PDF:', error);
            throw error;
        }
    }

    async verifyQuestions(questions) {
        const verifiedQuestions = [];
        
        for (const question of questions) {
            if (question.needs_verification) {
                try {
                    const correctAnswer = await this.searchCorrectAnswer(question);
                    if (correctAnswer) {
                        question.correct_answer = correctAnswer;
                        question.source = 'Internet';
                    }
                } catch (error) {
                    console.warn(`Could not verify answer for question ${question.id}:`, error);
                }
            }
            verifiedQuestions.push(question);
        }
        
        return verifiedQuestions;
    }

    async searchCorrectAnswer(question) {
        try {
            const prompt = `Given the following question and options, determine the correct answer.
            Only respond with the option key (A, B, C, or D).
            
            Question: ${question.question}
            Options: ${JSON.stringify(question.options, null, 2)}`;

            const response = await fetch(`${this.apiUrl}${this.model}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : ''
                },
                body: JSON.stringify({
                    inputs: prompt,
                    parameters: {
                        max_new_tokens: 10,
                        temperature: 0.3,
                        return_full_text: false
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.statusText}`);
            }

            const data = await response.json();
            const answer = Array.isArray(data) ? data[0].generated_text : data.generated_text;
            
            // Extract just the option letter if it's part of a longer response
            const optionMatch = answer.trim().match(/[A-D]/);
            if (optionMatch) {
                return optionMatch[0];
            }
            return null;

        } catch (error) {
            console.error('Error searching for correct answer:', error);
            return null;
        }
    }

    async saveQuestions(questions, existingQuestions = []) {
        // Add IDs to new questions
        const startId = existingQuestions.length + 1;
        questions.forEach((q, index) => {
            q.id = startId + index;
        });

        // Combine with existing questions
        const allQuestions = [...existingQuestions, ...questions];

        // Save to localStorage
        localStorage.setItem('quiz_questions', JSON.stringify({
            questions: allQuestions
        }));

        return allQuestions;
    }
}

// Example usage:
/*
const extractor = new QuizExtractor('your-openai-api-key');

// Handle file upload
document.getElementById('pdfFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        try {
            // Extract questions from PDF
            const questions = await extractor.extractQuestionsFromPDF(file);
            
            // Load existing questions
            const existingQuestions = JSON.parse(localStorage.getItem('quiz_questions') || '{"questions":[]}').questions;
            
            // Save all questions
            const allQuestions = await extractor.saveQuestions(questions, existingQuestions);
            
            console.log('Processed questions:', allQuestions);
        } catch (error) {
            console.error('Error processing PDF:', error);
        }
    }
});
*/ 