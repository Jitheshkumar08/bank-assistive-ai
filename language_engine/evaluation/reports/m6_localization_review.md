# M6 localisation review sheet

**Review status: unreviewed.** Authored by: development assistant (not a native speaker).

No entry below has been checked by a native speaker. Please review each Kannada and Hindi
rendering for meaning, register (polite, clear, suitable for a bank counter) and natural word
order, and mark corrections in the catalog (`app/dialogue/localization_catalog.py`). Slots in
braces are filled at runtime: `{instruction}` with a step below, `{workflow}` / `{current}` /
`{requested}` with a name below, `{n}` / `{k}` with digits.

Points worth a reviewer's attention:

- Workflow names are always followed by a noun (ವಿನಂತಿ / ಪ್ರಕ್ರಿಯೆ, अनुरोध / प्रक्रिया), so
  case endings attach to the noun. Check the combinations read naturally.
- The conflict question deliberately uses ರದ್ದು / ವಿರಾಮ / ಮುಂದುವರಿಸ and रद्द / विराम / जारी:
  the engine recognises exactly those words in the customer's answer. A rewording must keep them.
- The resume hint quotes 'ಮುಂದುವರಿಸಿ' / 'जारी रखो', which the engine recognises as resume.
- Hindi sentences end in "." (as the 3.2B-12 renderings did) rather than "।".

## Workflow steps (11)

| English | Kannada | Hindi |
|---|---|---|
| Please take a deposit slip. | ದಯವಿಟ್ಟು ಒಂದು ಹಣ ಜಮಾ ಚೀಟಿ (ಡೆಪಾಸಿಟ್ ಸ್ಲಿಪ್) ತೆಗೆದುಕೊಳ್ಳಿ. | कृपया एक जमा पर्ची (डिपॉज़िट स्लिप) लीजिए. |
| Fill in your account number. | ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಿರಿ. | अपना खाता नंबर भरिए. |
| Enter the amount to deposit. | ಜಮಾ ಮಾಡಬೇಕಾದ ಮೊತ್ತವನ್ನು ಬರೆಯಿರಿ. | जमा की जाने वाली राशि लिखिए. |
| Submit the slip along with the cash. | ಚೀಟಿಯನ್ನು ನಗದಿನೊಂದಿಗೆ ಸಲ್ಲಿಸಿ. | पर्ची नकद के साथ जमा कर दीजिए. |
| Please take a withdrawal slip. | ದಯವಿಟ್ಟು ಒಂದು ಹಣ ತೆಗೆಯುವ ಚೀಟಿ (ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್) ತೆಗೆದುಕೊಳ್ಳಿ. | कृपया एक निकासी पर्ची (विड्रॉल स्लिप) लीजिए. |
| Enter the withdrawal amount. | ತೆಗೆಯಬೇಕಾದ ಮೊತ್ತವನ್ನು ಬರೆಯಿರಿ. | निकाली जाने वाली राशि लिखिए. |
| Sign the withdrawal slip. | ಹಣ ತೆಗೆಯುವ ಚೀಟಿಗೆ ಸಹಿ ಮಾಡಿ. | निकासी पर्ची पर हस्ताक्षर कीजिए. |
| Submit the slip to the cashier. | ಚೀಟಿಯನ್ನು ಕ್ಯಾಷಿಯರ್‌ಗೆ ನೀಡಿ. | पर्ची कैशियर को दीजिए. |
| Please proceed to the loan assistance desk. | ದಯವಿಟ್ಟು ಸಾಲ ಸಹಾಯ ಕೌಂಟರ್‌ಗೆ ಹೋಗಿ. | कृपया लोन सहायता डेस्क पर जाइए. |
| Collect the loan application form. | ಸಾಲದ ಅರ್ಜಿ ನಮೂನೆಯನ್ನು ಪಡೆದುಕೊಳ್ಳಿ. | लोन आवेदन फ़ॉर्म ले लीजिए. |
| Keep your identity documents ready. | ನಿಮ್ಮ ಗುರುತಿನ ದಾಖಲೆಗಳನ್ನು ಸಿದ್ಧವಾಗಿಟ್ಟುಕೊಳ್ಳಿ. | अपने पहचान दस्तावेज़ तैयार रखिए. |

## Workflow names (5)

| English (display / canonical) | Kannada | Hindi |
|---|---|---|
| deposit / deposit money | ಹಣ ಜಮಾ | जमा |
| withdrawal / withdraw money | ಹಣ ತೆಗೆಯುವ | निकासी |
| loan application / apply for loan | ಸಾಲದ ಅರ್ಜಿ | लोन आवेदन |
| balance check / check account balance | ಬ್ಯಾಲೆನ್ಸ್ ಪರಿಶೀಲನೆ | बैलेंस जांच |
| account opening / open new account | ಹೊಸ ಖಾತೆ ತೆರೆಯುವ | नया खाता |

## Sentences (64)

| English | Kannada | Hindi |
|---|---|---|
| You're welcome. | ಸ್ವಾಗತ. | आपका स्वागत है. |
| Okay. | ಸರಿ. | ठीक है. |
| Continuing. | ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ. | जारी रख रहा हूँ. |
| Let's continue. | ಮುಂದುವರಿಸೋಣ. | आइए जारी रखें. |
| I've noted that. | ಅದನ್ನು ಗಮನಿಸಿದ್ದೇನೆ. | मैंने यह नोट कर लिया है. |
| Let me know when you've completed it. | ಅದನ್ನು ಮುಗಿಸಿದ ನಂತರ ನನಗೆ ತಿಳಿಸಿ. | पूरा हो जाने पर मुझे बताइए. |
| Take your time and let me know when you are ready. | ನಿಧಾನವಾಗಿ ಮಾಡಿ, ಸಿದ್ಧರಾದಾಗ ತಿಳಿಸಿ. | आराम से कीजिए, तैयार होने पर बताइए. |
| You're still on: {instruction} | ನೀವು ಇನ್ನೂ ಈ ಹಂತದಲ್ಲಿದ್ದೀರಿ: {instruction} | आप अभी भी इस चरण पर हैं: {instruction} |
| Workflow Completed. | ಪ್ರಕ್ರಿಯೆ ಪೂರ್ಣಗೊಂಡಿದೆ. | प्रक्रिया पूरी हो गई. |
| There's nothing active right now. | ಈಗ ಯಾವುದೇ ಪ್ರಕ್ರಿಯೆ ಚಾಲನೆಯಲ್ಲಿಲ್ಲ. | अभी कोई प्रक्रिया सक्रिय नहीं है. |
| There's no active request right now. | ಈಗ ಯಾವುದೇ ವಿನಂತಿ ಚಾಲನೆಯಲ್ಲಿಲ್ಲ. | अभी कोई अनुरोध सक्रिय नहीं है. |
| There's no active request to control right now. | ಈಗ ನಿಯಂತ್ರಿಸಲು ಯಾವುದೇ ವಿನಂತಿ ಇಲ್ಲ. | अभी नियंत्रित करने के लिए कोई अनुरोध नहीं है. |
| There's no active request to refer to right now. | ಈಗ ಉಲ್ಲೇಖಿಸಲು ಯಾವುದೇ ಸಕ್ರಿಯ ವಿನಂತಿ ಇಲ್ಲ. | अभी संदर्भ के लिए कोई सक्रिय अनुरोध नहीं है. |
| That request is already active. | ಆ ವಿನಂತಿ ಈಗಾಗಲೇ ಚಾಲನೆಯಲ್ಲಿದೆ. | वह अनुरोध पहले से सक्रिय है. |
| That request is already paused. | ಆ ವಿನಂತಿ ಈಗಾಗಲೇ ವಿರಾಮದಲ್ಲಿದೆ. | वह अनुरोध पहले से रुका हुआ है. |
| That request is still paused. | ಆ ವಿನಂತಿ ಇನ್ನೂ ವಿರಾಮದಲ್ಲಿದೆ. | वह अनुरोध अभी भी रुका हुआ है. |
| Your request is already completed. | ನಿಮ್ಮ ವಿನಂತಿ ಈಗಾಗಲೇ ಪೂರ್ಣಗೊಂಡಿದೆ. | आपका अनुरोध पहले ही पूरा हो चुका है. |
| That request was cancelled. | ಆ ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಲಾಗಿದೆ. | वह अनुरोध रद्द कर दिया गया था. |
| Okay, I've paused this request. | ಸರಿ, ಈ ವಿನಂತಿಯನ್ನು ವಿರಾಮಗೊಳಿಸಿದ್ದೇನೆ. | ठीक है, मैंने यह अनुरोध रोक दिया है. |
| Let me know when you're ready to continue. | ಮುಂದುವರಿಸಲು ಸಿದ್ಧರಾದಾಗ ತಿಳಿಸಿ. | जब आप आगे बढ़ने के लिए तैयार हों, तो बताइए. |
| Say resume when you'd like to continue. | ಮುಂದುವರಿಸಬೇಕೆಂದಾಗ 'ಮುಂದುವರಿಸಿ' ಎಂದು ಹೇಳಿ. | जब आगे बढ़ना हो, तो 'जारी रखो' कहिए. |
| Okay, I've cancelled that request. | ಸರಿ, ಆ ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಿದ್ದೇನೆ. | ठीक है, मैंने वह अनुरोध रद्द कर दिया है. |
| There's nothing active to cancel right now. | ರದ್ದು ಮಾಡಲು ಈಗ ಏನೂ ಇಲ್ಲ. | अभी रद्द करने के लिए कुछ नहीं है. |
| There's nothing active to pause right now. | ವಿರಾಮಗೊಳಿಸಲು ಈಗ ಏನೂ ಇಲ್ಲ. | अभी रोकने के लिए कुछ नहीं है. |
| There's nothing to repeat right now. | ಈಗ ಪುನಃ ಹೇಳಲು ಏನೂ ಇಲ್ಲ. | अभी दोहराने के लिए कुछ नहीं है. |
| What banking service would you like help with? | ಯಾವ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆಗೆ ಸಹಾಯ ಬೇಕು? | आपको किस बैंकिंग सेवा में मदद चाहिए? |
| Let me know which banking service you'd like help with. | ಯಾವ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆ ಬೇಕು ಎಂದು ತಿಳಿಸಿ. | बताइए आपको कौन सी बैंकिंग सेवा चाहिए. |
| Let me know if you'd like help with anything else. | ಬೇರೆ ಏನಾದರೂ ಸಹಾಯ ಬೇಕಿದ್ದರೆ ತಿಳಿಸಿ. | किसी और चीज़ में मदद चाहिए तो बताइए. |
| Let me know if you'd like help with something else. | ಬೇರೆ ಯಾವುದಕ್ಕಾದರೂ ಸಹಾಯ ಬೇಕಿದ್ದರೆ ತಿಳಿಸಿ. | किसी और काम में मदद चाहिए तो बताइए. |
| Would you like help with anything else? | ಬೇರೆ ಏನಾದರೂ ಸಹಾಯ ಬೇಕೇ? | क्या आपको किसी और चीज़ में मदद चाहिए? |
| Thank you for using the banking assistant. | ಬ್ಯಾಂಕಿಂಗ್ ಸಹಾಯಕವನ್ನು ಬಳಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. | बैंकिंग सहायक का उपयोग करने के लिए धन्यवाद. |
| I can't help with that. | ಅದಕ್ಕೆ ನಾನು ಸಹಾಯ ಮಾಡಲಾರೆ. | इसमें मैं मदद नहीं कर सकता. |
| I can help you deposit money, withdraw money, check your balance, apply for a loan or open an account. | ಹಣ ಜಮಾ, ಹಣ ತೆಗೆಯುವುದು, ಬ್ಯಾಲೆನ್ಸ್ ಪರಿಶೀಲನೆ, ಸಾಲದ ಅರ್ಜಿ ಅಥವಾ ಹೊಸ ಖಾತೆ ತೆರೆಯಲು ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. | मैं पैसे जमा करने, निकालने, बैलेंस देखने, लोन के आवेदन या नया खाता खोलने में मदद कर सकता हूँ. |
| Which would you like? | ಯಾವುದು ಬೇಕು? | आपको क्या चाहिए? |
| Sorry, I didn't catch that. | ಕ್ಷಮಿಸಿ, ನನಗೆ ಅದು ಅರ್ಥವಾಗಲಿಲ್ಲ. | क्षमा करें, मैं वह समझ नहीं पाया. |
| Could you say that again? | ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ? | क्या आप फिर से कह सकते हैं? |
| I did not catch that. | ನನಗೆ ಅದು ಅರ್ಥವಾಗಲಿಲ್ಲ. | मैं वह समझ नहीं पाया. |
| Could you say it again? | ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ? | क्या आप इसे फिर से कह सकते हैं? |
| Sorry, I hit a temporary problem handling that. | ಕ್ಷಮಿಸಿ, ಅದನ್ನು ನಿರ್ವಹಿಸುವಾಗ ತಾತ್ಕಾಲಿಕ ಸಮಸ್ಯೆ ಉಂಟಾಯಿತು. | क्षमा करें, इसे संभालते समय एक अस्थायी समस्या आई. |
| Your request is still saved -- please say that again. | ನಿಮ್ಮ ವಿನಂತಿ ಇನ್ನೂ ಉಳಿದಿದೆ -- ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ. | आपका अनुरोध अभी भी सुरक्षित है -- कृपया फिर से कहिए. |
| Sorry, I'm having trouble looking that up right now. | ಕ್ಷಮಿಸಿ, ಈಗ ಅದನ್ನು ಹುಡುಕುವಲ್ಲಿ ತೊಂದರೆಯಾಗುತ್ತಿದೆ. | क्षमा करें, अभी इसे खोजने में दिक्कत हो रही है. |
| Please try asking again in a moment. | ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಕೇಳಿ. | कृपया थोड़ी देर बाद फिर से पूछिए. |
| I understood your request, but I don't have a guided procedure for that service yet. | ನಿಮ್ಮ ವಿನಂತಿ ಅರ್ಥವಾಯಿತು, ಆದರೆ ಆ ಸೇವೆಗೆ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಮಾರ್ಗದರ್ಶಿತ ಪ್ರಕ್ರಿಯೆ ಇಲ್ಲ. | मैं आपका अनुरोध समझ गया, लेकिन उस सेवा के लिए मेरे पास अभी कोई निर्देशित प्रक्रिया नहीं है. |
| You can still ask me questions about it, or tell me another banking service you'd like help with. | ಆದರೂ ಅದರ ಬಗ್ಗೆ ಪ್ರಶ್ನೆಗಳನ್ನು ಕೇಳಬಹುದು, ಅಥವಾ ನಿಮಗೆ ಬೇಕಾದ ಬೇರೆ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆಯನ್ನು ತಿಳಿಸಬಹುದು. | आप फिर भी इसके बारे में सवाल पूछ सकते हैं, या कोई दूसरी बैंकिंग सेवा बता सकते हैं जिसमें आपको मदद चाहिए. |
| I don't have a guided procedure for that service, so I can't read out its steps. | ಆ ಸೇವೆಗೆ ನನ್ನ ಬಳಿ ಮಾರ್ಗದರ್ಶಿತ ಪ್ರಕ್ರಿಯೆ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಅದರ ಹಂತಗಳನ್ನು ಓದಲು ಸಾಧ್ಯವಿಲ್ಲ. | उस सेवा के लिए मेरे पास कोई निर्देशित प्रक्रिया नहीं है, इसलिए मैं उसके चरण नहीं पढ़ सकता. |
| I understood you'd like help with {workflow}, but I don't have a guided procedure for that yet. | ನಿಮಗೆ {workflow} ಸೇವೆಯಲ್ಲಿ ಸಹಾಯ ಬೇಕು ಎಂದು ಅರ್ಥವಾಯಿತು, ಆದರೆ ಅದಕ್ಕೆ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಮಾರ್ಗದರ್ಶಿತ ಪ್ರಕ್ರಿಯೆ ಇಲ್ಲ. | मैं समझ गया कि आपको {workflow} सेवा में मदद चाहिए, लेकिन उसके लिए मेरे पास अभी कोई निर्देशित प्रक्रिया नहीं है. |
| I don't have a guided procedure for {workflow} yet, so I've left your {workflow2} exactly as it was. | {workflow} ಸೇವೆಗೆ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಮಾರ್ಗದರ್ಶಿತ ಪ್ರಕ್ರಿಯೆ ಇಲ್ಲ, ಆದ್ದರಿಂದ ನಿಮ್ಮ {workflow2} ವಿನಂತಿಯನ್ನು ಇದ್ದಂತೆಯೇ ಬಿಟ್ಟಿದ್ದೇನೆ. | {workflow} सेवा के लिए मेरे पास अभी कोई निर्देशित प्रक्रिया नहीं है, इसलिए मैंने आपका {workflow2} अनुरोध जैसा था वैसा ही छोड़ दिया है. |
| Your {workflow} is still in progress. | ನಿಮ್ಮ {workflow} ವಿನಂತಿ ಇನ್ನೂ ಪ್ರಗತಿಯಲ್ಲಿದೆ. | आपका {workflow} अनुरोध अभी भी जारी है. |
| You currently have a {current} in progress. | ನಿಮ್ಮ {current} ವಿನಂತಿ ಈಗ ಪ್ರಗತಿಯಲ್ಲಿದೆ. | आपका {current} अनुरोध अभी चल रहा है. |
| Your {current} is currently paused. | ನಿಮ್ಮ {current} ವಿನಂತಿ ಈಗ ವಿರಾಮದಲ್ಲಿದೆ. | आपका {current} अनुरोध अभी रुका हुआ है. |
| Would you like to cancel the {current} and start a {requested}, pause the {current} and start a {requested}, or continue with the {current}? | {current} ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಿ {requested} ವಿನಂತಿ ಆರಂಭಿಸಬೇಕೇ, {current} ವಿನಂತಿಯನ್ನು ವಿರಾಮಗೊಳಿಸಿ {requested} ವಿನಂತಿ ಆರಂಭಿಸಬೇಕೇ, ಅಥವಾ {current} ವಿನಂತಿಯನ್ನೇ ಮುಂದುವರಿಸಬೇಕೇ? | क्या आप {current} अनुरोध रद्द करके {requested} अनुरोध शुरू करना चाहेंगे, {current} अनुरोध को विराम देकर {requested} अनुरोध शुरू करना चाहेंगे, या {current} अनुरोध ही जारी रखना चाहेंगे? |
| Would you like to cancel the {current} and start a {requested}, keep the {current} paused and start a {requested}, or continue with the {current}? | {current} ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಿ {requested} ವಿನಂತಿ ಆರಂಭಿಸಬೇಕೇ, {current} ವಿನಂತಿಯನ್ನು ವಿರಾಮದಲ್ಲೇ ಇಟ್ಟು {requested} ವಿನಂತಿ ಆರಂಭಿಸಬೇಕೇ, ಅಥವಾ {current} ವಿನಂತಿಯನ್ನೇ ಮುಂದುವರಿಸಬೇಕೇ? | क्या आप {current} अनुरोध रद्द करके {requested} अनुरोध शुरू करना चाहेंगे, {current} अनुरोध को विराम में रखकर {requested} अनुरोध शुरू करना चाहेंगे, या {current} अनुरोध ही जारी रखना चाहेंगे? |
| Okay, I've cancelled the {workflow}. | ಸರಿ, {workflow} ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಿದ್ದೇನೆ. | ठीक है, मैंने {workflow} अनुरोध रद्द कर दिया है. |
| Okay, I've paused the {workflow} and you can come back to it later. | ಸರಿ, {workflow} ವಿನಂತಿಯನ್ನು ವಿರಾಮಗೊಳಿಸಿದ್ದೇನೆ; ನಂತರ ಅದಕ್ಕೆ ಮರಳಬಹುದು. | ठीक है, मैंने {workflow} अनुरोध रोक दिया है, आप बाद में इस पर लौट सकते हैं. |
| Let's start the {workflow}. | {workflow} ವಿನಂತಿಯನ್ನು ಆರಂಭಿಸೋಣ. | आइए {workflow} अनुरोध शुरू करें. |
| Okay, let's continue with the {workflow}. | ಸರಿ, {workflow} ವಿನಂತಿಯನ್ನು ಮುಂದುವರಿಸೋಣ. | ठीक है, {workflow} अनुरोध जारी रखते हैं. |
| Okay, we'll carry on with the {workflow}. | ಸರಿ, {workflow} ವಿನಂತಿಯನ್ನೇ ಮುಂದುವರಿಸುತ್ತೇವೆ. | ठीक है, हम {workflow} अनुरोध ही जारी रखेंगे. |
| Step {n}: {instruction} | ಹಂತ {n}: {instruction} | चरण {n}: {instruction} |
| Step {n} of the {workflow} process is: {instruction} | {workflow} ಪ್ರಕ್ರಿಯೆಯ ಹಂತ {n}: {instruction} | {workflow} प्रक्रिया का चरण {n}: {instruction} |
| That request only has {k} steps, so there's no step {n}. | ಆ ವಿನಂತಿಯಲ್ಲಿ {k} ಹಂತಗಳು ಮಾತ್ರ ಇವೆ, ಆದ್ದರಿಂದ ಹಂತ {n} ಇಲ್ಲ. | उस अनुरोध में केवल {k} चरण हैं, इसलिए चरण {n} नहीं है. |
| I couldn't tell which step you meant. | ನೀವು ಯಾವ ಹಂತವನ್ನು ಉದ್ದೇಶಿಸಿದ್ದೀರಿ ಎಂದು ನನಗೆ ತಿಳಿಯಲಿಲ್ಲ. | मैं समझ नहीं पाया कि आप किस चरण की बात कर रहे हैं. |
| You can say, for example, step 2. | ಉದಾಹರಣೆಗೆ, ಹಂತ 2 ಎಂದು ಹೇಳಬಹುದು. | आप उदाहरण के लिए, चरण 2 कह सकते हैं. |
| That step is not available in the current workflow. | ಈಗಿನ ಪ್ರಕ್ರಿಯೆಯಲ್ಲಿ ಆ ಹಂತ ಲಭ್ಯವಿಲ್ಲ. | मौजूदा प्रक्रिया में वह चरण उपलब्ध नहीं है. |
| Sorry, I can no longer access the steps for that request. | ಕ್ಷಮಿಸಿ, ಆ ವಿನಂತಿಯ ಹಂತಗಳು ಈಗ ನನಗೆ ಲಭ್ಯವಿಲ್ಲ. | क्षमा करें, उस अनुरोध के चरण अब मेरे पास उपलब्ध नहीं हैं. |

## Fallback marker

Shown before any part of a fixed reply that has no rendering (none is reachable today).

| Kannada | Hindi |
|---|---|
| (ಈ ಭಾಗ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮಾತ್ರ ಲಭ್ಯವಿದೆ:) | (यह हिस्सा केवल अंग्रेज़ी में उपलब्ध है:) |
