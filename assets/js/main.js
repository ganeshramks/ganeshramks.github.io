$(document).ready(function(){
	
	$("#1").click(function(){
		$('#selfie-modal').modal('show');
	});
		
	$("#2").click(function(){
		$('#smart-modal').modal('show');
	});
		
	$("#3").click(function(){
		$('#e-yantra-modal').modal('show');
	});
		
	$("#4").click(function(){
		$('#robometry-modal').modal('show');
	});

	var news_papers = ["the-hindu.jpeg", "young-world-the-hindu.jpeg", "bangalore-vijay-times.jpeg", "times-of-india.jpeg", "deccan-herald.jpeg", "vijay-karnataka.jpeg"];

	img_url_prefix = "assets/img/newspaper/";

	for (var i = 0; i < news_papers.length; i++) {
		selector = '#news_paper_' +	(i + 1);
		$(selector).width('100%').height('100%').attr('src', img_url_prefix + news_papers[i]);
	}

});